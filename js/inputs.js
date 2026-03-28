import {player, scene, engine, canvas, gameSettings, game, keysDown} from "./globals.js";
import * as utils from "./utils.js";
import * as dialog from "./dialog.js";
import * as screen from "./screen.js";
import * as level from "./level.js";
import * as npc from "./npc.js";
import * as movement from "./movement.js";

export let lastScroll = performance.now();
let suppressNextJump = false;
const gameInputs = gameSettings.controls; // TODO: Fetch from a `controls.cfg` or even `controls.json` file instead

/** @desc Registers all scene input observables for keyboard and pointer events. Must be called after scene initialization */
export function initInputHandlers() {
  scene.onKeyboardObservable.add((kbInfo) => { const key = kbInfo.event; if (key.repeat) return;
    if (document.pointerLockElement) key.preventDefault(); // Prevents events like file menu, ctrl + w, etc. while pointerLocked
    const isDown = kbInfo.type === BABYLON.KeyboardEventTypes.KEYDOWN;
    keysDown[key.code] = isDown;
    // Mirror movement key states (true on press, false on release)
    if (key.code === gameInputs.forward) player.movement.forward = isDown;
    if (key.code === gameInputs.back) player.movement.back = isDown;
    if (key.code === gameInputs.left) player.movement.left = isDown;
    if (key.code === gameInputs.right) player.movement.right = isDown;
    if (key.code === gameInputs.walk) player.movement.isWalking = isDown;
    if (key.code === gameInputs.sprint) player.movement.isSprinting = isDown;
    player.movement.isMoving = !!(player.movement.forward || player.movement.back || player.movement.left || player.movement.right);
    // KEYDOWN EVENTS
    if (isDown) {
      player.lastMoveTime = game.time;
      if(player.movement.isAfk) { player.movement.isAfk = false; } // If player presses ANY keys, no longer afk
      // Handle crouching toggle (& assigns player body height)
      if (key.code === gameInputs.crouch && player.canCrouch) {
        if (!player.movement.isCrouching) {
          movement.setManualCrouch(player.movement.isCrouching = true);
          utils.applyBodyScale(utils.vec3(player.bodyScale, player.bodyScale * gameSettings.defaultCrouchHeight, player.bodyScale), false);
        } else {
          movement.setManualCrouch(false); // Signal intent to uncrouch; tryAutoUncrouch will auto-uncrouch when safe if head is blocked
          if (movement.isHeadClear()) {
            player.movement.isCrouching = false;
            utils.applyBodyScale(utils.vec3(player.bodyScale, player.bodyScale, player.bodyScale), false);
          }
        }
      }
      // Handle jumping (charging jump height)
      if (key.code === gameInputs.jump) {
        if (!dialog.isDialogPlaying()) suppressNextJump = false;
        player.movement.isJumpBtnDown = true;
        if (player.canChargeJump) player.jumpChargeStart = performance.now();
      }
      // Handle use/interact key
      if (key.code === gameInputs.interact) {
        if (npc.currentlyLookingAtNPC && !dialog.isDialogPlaying()) {
          player.questState.npcName = npc.currentlyLookingAtNPC.name;
          let questPath = "./res/dialog/"+player.questState.npcName+"_", questStep = "quest.json", startNode = undefined;
          // Determine which dialog sequence to play, based on `player.questState` booleans
          if (player.questState.rewardClaimed) { questStep = "lore.json"; }
          else if (player.questState.complete) { startNode = "reward_start"; player.questState.rewardClaimed = true; }
          else if (player.questState.started) { questStep = "quest_inProgress.json"; }
          dialog.startDialog(questPath + questStep, startNode).then(() => { game.curMenu = "ingame"; });
        }
      }
      // Handle dialog/cutscene inputs (checking for spacebar to continue, and numbers 1-9 for dialog choices)
      if (dialog.isDialogPlaying() && game.curMenu === "cutscene") {
        if (key.code === gameSettings.controls.proceedDialog && dialog.isTextPrinting()) {
          if (!dialog.getWaitForCondition()?.startsWith("jump:")) suppressNextJump = true; // Suppress jumping on nodes without a "jump:" waitFor condition specified
        } else if (dialog.isInputEnabled()) {
          if (dialog.getDialogChoices().length > 0) {
            // Loops through to see if "Digit1-9" was pressed, then passes that key number to dialog.handleQuestionNode
            for (let i = 1; i < 10; i++) { if (key.code === "Digit"+i) { dialog.handleQuestionNode(i); } }
          } else if (key.code === gameSettings.controls.proceedDialog) { dialog.proceedDialog(); suppressNextJump = true; } // Proceed dialog when space pressed
        } else if (key.code === gameSettings.controls.proceedDialog) { dialog.showNextItem(); } // Step to next item in active showcase sequence on space
      }
      //TODO: Debug keys for testing, remove ALL of these later
      if (key.code === gameSettings.controls.devMenu) { gameSettings.debugMode = !gameSettings.debugMode; }
      if (key.code === "NumpadAdd") {utils.teleportPlayer(utils.vec3(8.5, 2, 6));}
      if (key.code === "NumpadSubtract") {utils.teleportPlayer(utils.vec3(0, 2, 0));}
      if (key.code === "KeyL") { // DEBUG: instantly collect all remaining collectables
        if (player.questState.started) {
          level.collectableGroupNodes.forEach(n => { n.setEnabled(false); });
          player.questState.complete = player.allCollected = true;
          player.collectableCount = level.totalCollectibles;
          utils.showToastPrompt("DEBUG: ✅ All items obtained: Return to '" + player.questState.npcName + "'! (This isn't meant to be seen by players)");
        }else{ console.log("DEBUG: No quest started, no items to collect"); }
      }
      if (key.code === "KeyM") { utils.applyBodyScale(utils.vec3(5, 5, 5)); }
      if (key.code === "KeyN") { utils.applyBodyScale(utils.vec3(1, 1, 1)); }
      if (key.code === "KeyO") { dialog.endDialog(); }
      if (key.code === "KeyP") { // Begin example dialog system showcase sequence
        dialog.startDialog("./res/dialog/dialog_system_examples.json").then(() => {
          utils.showToastPrompt("DEBUG: This is an example of a function running after a dialog sequence has completed.\nAnything can go here, such as teleporting the player and showing this message, in this case\n(This isn't meant to be seen by players)");
          utils.teleportPlayer(utils.vec3(0, 10, 0));
        });
      }
    // KEYUP EVENTS
    } else {
      if (key.code === gameInputs.jump && player.movement.isJumpBtnDown) {
        player.movement.isJumpBtnDown = false;
        if (suppressNextJump && dialog.isDialogPlaying()) { suppressNextJump = false; }
        else { suppressNextJump = false; player.movement.isJumping = true; }
      }
    }
  });
  scene.onPointerObservable.add((pointerInfo) => {
    switch (pointerInfo.type) {
      case BABYLON.PointerEventTypes.POINTERDOWN:
        if (game.curMenu === "ingame" || game.curMenu === "cutscene") {
          if (!player.cursorLocked) canvas.requestPointerLock();
          if (player.cursorLocked && pointerInfo.event.button === 0 && player.canPaw) { // Swat mechanic (left click)
            if (player.movement.isAfk) player.movement.isAfk = false;
            player.lastMoveTime = game.time;
            player.swatting = true;
          }
          if (player.cursorLocked && pointerInfo.event.button === 2 && player.canBite) { // Biting mechanic (right click)
            player.movement.isBiting = true;
            utils.startBite();
          }
        }
        break;
      case BABYLON.PointerEventTypes.POINTERUP:
        if (pointerInfo.event.button === 0) player.swatting = false;
        if (pointerInfo.event.button === 2 && player.movement.isBiting) utils.releaseBite();
        break;
      case BABYLON.PointerEventTypes.POINTERMOVE:
        if (player.cursorLocked) { player.lastMoveTime = game.time; if (player.movement.isAfk) player.movement.isAfk = false; }
        break;
      case BABYLON.PointerEventTypes.POINTERWHEEL:
        lastScroll = game.time;
        break;
    }
  });
}

document.addEventListener("pointerlockchange", () => {
  if(document.pointerLockElement !== canvas){
    game.curMenu = "pause"; player.cursorLocked = false;
    game.pausedAt = performance.now(); // Tracks last pause time for re-enabling resume button after delay
  }else{
    // Don't override "cutscene" with "ingame" while dialog is actively playing
    if(!dialog.isDialogPlaying()) game.curMenu = "ingame";
    player.cursorLocked = true;
  }
}); // Handle pointerlockchange event (aka user presses escape/alt+tab to exit pointer lock mode)
document.addEventListener("visibilitychange", () => {
  if(document.hidden && !game.paused){
    game.paused = true; utils.pauseScene();
    if(gameSettings.debugMode)console.log("Document visibility hidden, pausing scene...");
  }else if(!document.hidden){
    utils.resumeScene();
    if(gameSettings.debugMode)console.log("Document visibile again, resuming scene...");
  }
}); // Handle document visibilitychange event (aka window minimize/restore, window is obscured, etc...)
document.addEventListener("contextmenu", (event) => { event.preventDefault() }); // Prevent right click context menu
window.addEventListener("resize", () => { if(engine) engine.resize() }); // Handle window resizing

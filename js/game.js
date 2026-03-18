import {player, scene, engine, canvas, gameSettings, game} from "./globals.js";
import * as utils from "./utils.js";
import * as dialog from "./dialog.js";
import * as screen from "./screen.js";
import * as level from "./level.js";
import * as animation from "./animation.js";
import * as globals from "./globals.js";
import * as movement from "./movement.js";
import * as npc from "./npc.js";

export let lastScroll = performance.now();
const input = gameSettings.controls; // TODO: Fetch these from a `controls.cfg` file instead
let deltaTime;

/** @desc Initializes the game's `engine` and `scene` variables. Dynamically imports and initializes the HavokPhysics WASM plugin, then enables physics using `gameSettings.defaultGravity` */
export async function createNewScene() {
  let tempEngine, webGPUSupported = !!navigator.gpu; // Check if navigator.gpu exists
  if(webGPUSupported) {
    tempEngine = new BABYLON.WebGPUEngine(canvas, gameSettings.engineSettings);
  }else{ // Use WebGL as a fallback if WebGPU is not supported or enabled on user hardware
    console.error("Error initializing BabylonJS WebGPUEngine (using WebGL 2.0 fallback)");
    tempEngine = new BABYLON.Engine(canvas, true, gameSettings.engineSettings);
  }
  globals.setEngine(tempEngine); // Initialize & assign `engine` variable
  if(webGPUSupported) await engine.initAsync(); // Initialize WebGPU context & dependencies (if using WebGPU)
  globals.setScene(new BABYLON.Scene(engine)); // Initialize & assign `scene` variable
  const loadingScreen = $('#loadingScreen');
  engine.loadingScreen = {
    displayLoadingUI: () => loadingScreen.show(),
    hideLoadingUI: () => loadingScreen.hide(),
  };
  engine.displayLoadingUI();
  engine.renderEvenInBackground = false; // Disables scene rendering when window is in the background/minimized
  engine.deltaTime = 16; // Milliseconds per engine calculation (16.666ms = 60 calculations per second aka 60fps)
  const { default: HavokPhysics } = await import("./lib/HavokPhysics_es.js");
  const havokPlugin = new BABYLON.HavokPlugin(true, await HavokPhysics());
  scene.enablePhysics(gameSettings.defaultGravity, havokPlugin); // Using Havok physics
  // Do other scene setup stuff
  utils.initPlayerCamera(); // `player.camera` object initialization (must occur BEFORE loading/handling player mesh)
  scene.createDefaultLight(); // temporary scene lighting
  utils.createSkybox("res/skybox/Sky_LosAngeles"); // Create a skybox
  await utils.loadMesh("", player.curModel, "", true).then(utils.handlePlayerModel);
  animation.getSceneAnimations();
  initInputHandlers(); // Register scene input observables (must be called after setScene)
  // Now hide loading screen and assign scene render function and game loop
  scene.executeWhenReady(() => engine.hideLoadingUI());
  engine.runRenderLoop(() => scene.render());
  scene.onBeforeRenderObservable.add(renderLoop);
  scene.onBeforePhysicsObservable.add(() => { player.onGround = false; }); // Reset before each physics step
}
/** @desc Render loop, run every single scene frame render (~240 times per sec) */
export function renderLoop() {
  if(game.paused) return;
  if(player.cursorLocked)game.time = performance.now();
  game.currentFPS = engine.getFps(); // Update game.time and game.currentFPS
  deltaTime = performance.now() - game.lastFrameTime;
  // This is the game's GAME loop. Called 60 times/sec (used whenever possible, instead of outside this if statement)
  if (deltaTime > game.frameRateLimit) {
    game.lastFrameTime = game.time - (deltaTime % game.frameRateLimit);
    gameLoop();
  }
  utils.checkCameraCollision();
  animation.handleAnimations(); // Handles detection of animation state & plays appropriate animations
}
/** @desc Game loop, runs every 60 fps */
function gameLoop() {
  if(player.body) movement.handleMovement(); // Handle player movement & rotation
  screen.updateMenus(); // Updates on-screen elements (such as in-game HUD elements & settings menu options)
  npc.handleNPCInteractions(); // Check player proximity & look direction against spawned NPCs
  if(player.collectableCount >= level.totalCollectibles && level.totalCollectibles > 0) {
    // Do something once all collectables have been collected
    player.allCollected = true;
    console.log("You LITERALLY just collected every collectable ever... wowzers!!! ^_^");
  }
}

/** @desc Registers all scene input observables for keyboard and pointer events. Must be called after scene initialization */
function initInputHandlers() {
  scene.onKeyboardObservable.add((kbInfo) => {
    const key = kbInfo.event;
    if (document.pointerLockElement) key.preventDefault(); // Prevents browser keys like tab and alt from triggering while ingame
    if (key.repeat) return; // Don't allow repeat keypress via holding key down
    if (kbInfo.type === BABYLON.KeyboardEventTypes.KEYDOWN) {
      if (key.code === input.forward || key.code === input.back || key.code === input.left || key.code === input.right) {
        player.movement.isMoving = true; // Sets isMoving to true if player is pressing ANY directional keys
      }
      if (key.code === input.forward) player.movement.forward = true;
      if (key.code === input.back) player.movement.back = true;
      if (key.code === input.left) player.movement.left = true;
      if (key.code === input.right) player.movement.right = true;
      if (key.code === input.walk) player.movement.isWalking = true;
      if (key.code === input.sprint) player.movement.isSprinting = true;
      if (key.code === input.jump) player.movement.isJumpBtnDown = true;

      // handle dialog/cutscene inputs
      if (dialog.isDialogPlaying() && dialog.isInputEnabled() && game.curMenu === "cutscene") {
        if (dialog.getDialogChoices().length > 0) { // Detected dialog options, get user input
          // Loops through to see if "Digit1-9" was pressed, then passes that key number to dialog.handleQuestionNode
          for (let i = 1; i < 10; i++) { if (key.code === "Digit"+i) { dialog.handleQuestionNode(i); } }
        } else if (key.code === "Space") { dialog.proceedDialog(); } // Proceed dialog when space pressed
      }

      //TODO: Debug keys for testing, remove ALL of these later
      if (key.code === "NumpadAdd") {utils.teleportPlayer(utils.vec3(8.5, 2, 6));}
      if (key.code === "NumpadSubtract") {utils.teleportPlayer(utils.vec3(0, 2, 0));}
      if (key.code === "KeyP") {
        // Begin example intro cutscene/dialog sequence
        dialog.startDialog('./res/dialog/example_intro.json').then(function () {
          console.log("this shows AFTER cutscene has ended, either by completion OR interruption");
          utils.teleportPlayer(utils.vec3(0, 10, 0));
        });
      }
      if (key.code === "KeyO") dialog.endDialog(); // Force ends any currently playing dialog TODO: BREAKS THINGS, NOT GRACEFULLY HANDLED
      if (key.code === input.interact) {
        if (npc.currentlyLookingAtNPC) console.log(`Starting dialog with NPC named ${npc.currentlyLookingAtNPC.name}`);
      }
      if (key.code === gameSettings.controls.devMenu) {
        gameSettings.debugMode = !gameSettings.debugMode;
        console.log("Toggling debugMode ", gameSettings.debugMode);
        player.body.isVisible = gameSettings.debugMode;
      }
    }
    if (kbInfo.type === BABYLON.KeyboardEventTypes.KEYUP) {
      if (key.code === input.forward) {player.movement.forward = false;}
      if (key.code === input.back) {player.movement.back = false;}
      if (key.code === input.left) {player.movement.left = false;}
      if (key.code === input.right) {player.movement.right = false;}
      if (key.code === input.jump && player.movement.isJumpBtnDown) {
        player.movement.isJumping = true;
        player.movement.isJumpBtnDown = false;
      }
      if (!player.movement.forward && !player.movement.back && !player.movement.left && !player.movement.right) {
        player.movement.isMoving = false;
      }
      if (key.code === input.walk) {player.movement.isWalking = false;}
      if (key.code === input.sprint && player.movement.isSprinting) {player.movement.isSprinting = false;}
    }
  });
  scene.onPointerObservable.add((pointerInfo) => {
    switch (pointerInfo.type) {
      case BABYLON.PointerEventTypes.POINTERDOWN:
        if (game.curMenu === "ingame") {
          if (!dialog.isDialogPlaying()) canvas.requestPointerLock(); // Lock cursor on canvas click
          if (player.cursorLocked) { // Swat mechanic
            if (player.isAfk) player.isAfk = false;
            player.lastMoveTime = game.time;
            player.swatting = true;
          }
        }
        break;
      case BABYLON.PointerEventTypes.POINTERUP:
        player.swatting = false;
        break;
      case BABYLON.PointerEventTypes.POINTERWHEEL:
        lastScroll = game.time;
        break;
    }
  });
}
// Handle pointerlockchange event (aka user presses escape/alt+tab to exit `pointer lock` mode)
document.addEventListener("pointerlockchange", () => {
  if(document.pointerLockElement !== canvas){
    game.curMenu = "pause"; player.cursorLocked = false;
  }else{
    game.curMenu = "ingame"; player.cursorLocked = true;
  }
  if(gameSettings.debugMode)console.log("`pointerlockchange` Event triggered, pointer "+((game.curMenu === "ingame")?"":"no longer ")+"locked.");
});
// Handle document visibilitychange event (aka window minimize/restore, window is obscured, etc...)
document.addEventListener('visibilitychange', () => {
  if(document.hidden && !game.paused){
    game.paused = true;
    utils.pauseScene();
    if(gameSettings.debugMode)console.log("Document visibility hidden, pausing scene...");
  }else if(game.curMenu === "ingame"){
    game.paused = false;
    utils.resumeScene();
    if(gameSettings.debugMode)console.log("Document visibile again, resuming scene...");
  }
});
// Prevent right click context menu
document.addEventListener('contextmenu', (event) => {event.preventDefault()});
// Handle window resizing
window.addEventListener("resize", () => {if(engine)engine.resize()});
// After initializing event window handlers, initialize on-screen elements as well
screen.initScreenElements();

await createNewScene(); // Initialize the canvas, scene, engine, and player objects
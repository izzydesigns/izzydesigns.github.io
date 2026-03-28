import {game, keysDown, player, scene, ui} from "./globals.js";
import {collectableGroupNodes, totalCollectibles} from "./level.js";
import {camTargetChanged, pinCameraTo} from "./utils.js";

/**
 * Dialog/Cutscene .json file structure:
 * ===============================
 *
 * "start": "string" - This specifies the starting node name
 * "nodes": {object} - The core object containing all dialog nodes
 *   "node_name_here": {object} - The name of a specific dialog node
 *     "title": "string" - Title sequence text
 *     "subtitle": "string" - Subtitle text (smaller than title)
 *     "text": "string" - Dialog text
 *     "next": "string" - Name of next dialog node (unspecified = dialog ends)
 *     "delay": number - Milliseconds to wait before proceeding/allowing input
 *     "background": "string" - Sets background color
 *     "cutsceneBars": boolean - True/false toggle for "cinematic" horizontal black bars
 *     "cameraTarget": [array] OR "string" - [x,y,z] coordinates OR "mesh name" to target
 *     "cameraAngles": {object} - Specify camera angles
 *       "yaw": number - Yaw camera rotation
 *       "pitch": number - Pitch camera rotation
 *       "distance": number - Radius/distance from the camera's target
 *     "enable": [array] - Grants player abilities at node start: "move", "jump", "paw"
 *     "choices": [array of {objects}] - Contains a list of "text/next" dialog options
 *       "text": "string" - Dialog option text (shown to the user in order)
 *       "next": "string" - Name of dialog node to jump to, if selected
 * */

let dialogPromise, dialogResolve, dialogJSON, nextNode, cleanupNode, resolveNode, waitForCondition,
  nodeRequirements = {}, curDialogNode = '', dialogSpeed = 50/*ms per letter*/;
let abilitiesEnabled = new Set(); // Abilities unlocked mid-dialog persist across all subsequent nodes
let prevStates = { couldMove: false, couldJump: false, couldPaw: false, couldCrouch: false, couldBite: false };
const dialogState = {
  playing: false, paused: false,
  inputEnabled: false, questionNode: false,
  printing: false, instantPrint: false,
  cutsceneBars: false, choices: [],
};

/** @desc Returns `true` if a dialog sequence is currently active */
export function isDialogPlaying(){return dialogState.playing;}
/** @desc Returns `true` if the active dialog has been paused */
export function isDialogPaused(){return dialogState.paused;}
/** @desc Returns `true` if the dialog system is currently awaiting player input (spacebar or choice key) */
export function isInputEnabled(){return dialogState.inputEnabled;}
/** @desc Returns `true` if dialog text is currently being printed character by character */
export function isTextPrinting(){return dialogState.printing;}
/** @desc Takes a string "path" value to specify which .json file to parse (with added optional "startNodeOverride" parameter) */
export async function startDialog(path, startNodeOverride) {
  if(dialogState.playing || dialogState.paused){console.error("Dialog already playing, cannot start dialog...");return Promise.resolve();}
  // Creates return promise and ties resolve to dialogResolve (ideally resolved when endDialog() called)
  dialogPromise = new Promise(resolve => { dialogResolve = resolve; });
  try {
    const resp = await fetch(path); dialogJSON = await resp.json();
    if(!resp.ok || !dialogJSON || dialogJSON.nodes === undefined){console.error('Failed to load dialog JSON data, cannot start dialog...');return Promise.resolve();}
    let startNodeName = startNodeOverride || dialogJSON.start || Object.keys(dialogJSON.nodes)[0];
    if(!startNodeName){console.error('No valid "start" node found in dialog JSON, cannot start dialog...');return Promise.resolve();}
    game.curMenu = "cutscene";
    prevStates.couldMove = player.canMove; prevStates.couldJump = player.canJump; prevStates.couldPaw = player.canPaw; prevStates.couldCrouch = player.canCrouch; prevStates.couldBite = player.canBite;
    player.canMove = player.canJump = player.canPaw = player.canCrouch = player.canBite = false;
    abilitiesEnabled = new Set();
    curDialogNode = dialogJSON.nodes[startNodeName];
    dialogState.playing = true; dialogState.paused = false;
    ui.dialogOverlay.show();
    await handleDialogNode(curDialogNode);
    return dialogPromise; // This will resolve when endDialog calls dialogResolve()
  } catch (error) { console.error('Dialog error:', error.message); endDialog(); return Promise.reject(error); }
}
/** @desc Resumes a paused dialog, restoring cutscene bars, the overlay, and the condition prompt if a `waitFor` condition is still active */
export function resumeDialog() {dialogState.paused = false;showCutsceneBars(dialogState.cutsceneBars);game.curMenu = "cutscene";ui.dialogOverlay.show();if(waitForCondition)showWaitForPrompt();}
/** @desc Pauses the active dialog, hides the cutscene bars, overlay, and condition prompt without ending the sequence */
export function pauseDialog(){dialogState.paused = true;showCutsceneBars(false);ui.dialogOverlay.hide();ui.nodePromptElem.hide();}
/** @desc Advances to the next dialog node specified by `curDialogNode.next`. Ends dialog if no next node exists */
export async function proceedDialog() {
  if (!dialogState.playing) return;
  let nextDialogNode = dialogJSON.nodes[curDialogNode.next];
  if (!nextDialogNode) { endDialog(); return; } // If no nextDialogNode, endDialog(), otherwise...
  dialogState.inputEnabled = false;
  ui.choicesElem.empty();
  await handleDialogNode(curDialogNode = nextDialogNode); // Handle & assign nextDialogNode
}
/** @desc Fully terminates the active dialog sequence, cleans up observers, resets all dialog state, restores the player's pre-dialog movement/jump/paw abilities, hides UI elements, and resolves the promise returned by `startDialog()` */
export function endDialog(){
  // Restore camera target if we changed it (pinCameraTo() resets camTargetChanged internally)
  if (camTargetChanged && player.camera) { pinCameraTo(); }
  // Clean up observers and unblock any pending awaits
  if (cleanupNode) { cleanupNode() } if (resolveNode) { resolveNode() } if (dialogResolve) { dialogResolve() }
  // Set all relevant booleans to false
  dialogState.playing = dialogState.paused = dialogState.inputEnabled = dialogState.printing = dialogState.instantPrint = false;
  dialogJSON = dialogPromise = dialogResolve = waitForCondition = cleanupNode = resolveNode = undefined;
  // Reset strings & UI states
  ui.dialogText.text(''); ui.charText.text(''); curDialogNode = '';
  showTitlecard('','',false);
  showCutsceneBars(false); ui.choicesElem.empty(); ui.nodePromptElem.hide();
  // Restores prior abilities, before dialog started
  player.canMove = prevStates.couldMove; player.canJump = prevStates.couldJump;
  player.canPaw = prevStates.couldPaw; player.canCrouch = prevStates.couldCrouch;
  player.canBite = prevStates.couldBite;
}
/** @desc Returns the current array of dialog choice objects for the active question node */
export function getDialogChoices(){return dialogState.choices;}
/** @desc Returns the current waitFor string, or undefined if none is active */
export function getWaitForCondition(){return waitForCondition;}
/** @desc Enables player input and populates the choices list with numbered options. If no choices are provided, shows a "Press spacebar to continue" prompt instead */
function getUserInput(questions){
  dialogState.inputEnabled = true; // Enable key inputs (utilized in `input.js`)
  if(questions){ // Asking user for dialog input
    for (let curChoice in questions) {
      let choiceNum = (Number)(curChoice) + 1;
      ui.choicesElem.append("<li class='dialogAnswer'>" + choiceNum + " - " + questions[curChoice].text + "</li>");
    }
  }else{ // Asking user for spacebar, to simply proceed dialog
    ui.choicesElem.append("<li class='continue'>Press spacebar to continue...</li>");
  }
}
/** @desc Takes a number (1-9) and handles which dialog node to proceed to. If no "next" value found, endDialog() is called */
export async function handleQuestionNode(key){
  if (!dialogState.playing) return;
  let curChoice = curDialogNode.choices[key-1]; if(!curChoice)return;
  curDialogNode = dialogJSON.nodes[curChoice.next];
  // End dialog if no "next" node found
  if(!curDialogNode) { endDialog(); } else { // Otherwise, handle the next dialog node
    dialogState.choices = [];
    ui.choicesElem.empty(); // Clear the choicesElem of dialog choice elements
    dialogState.inputEnabled = dialogState.questionNode = false;
    await handleDialogNode(curDialogNode);
  }
}
/** @desc Processes a single dialog node object, resets UI state, applies node properties (title, text, camera, cutsceneBars, enable, waitFor, choices), and awaits player input or condition resolution before returning */
async function handleDialogNode(curNode) {
  if (!curNode) {console.error("No valid node detected, dialog interrupted!");endDialog();return;}
  /* Reset SOME on-screen elements each time a new dialog node is processed: */
  showTitlecard('', '', false); // Reset titlecard
  ui.charText.text(''); ui.nodePromptElem.hide(); // Reset character text and condition prompt
  // Reset all player abilities, add this node's flags to the persistent set, then apply everything unlocked so far
  player.canMove = player.canJump = player.canPaw = player.canCrouch = false;
  if (curNode.clearAbilities) abilitiesEnabled.clear(); // Allows "clearAbilities" node to revoke all previously granted abilities
  if (curNode.enable !== undefined) for (const flag of curNode.enable) abilitiesEnabled.add(flag);
  for (const flag of abilitiesEnabled) {
    if(flag === "move") player.canMove = true;
    if(flag === "jump") player.canJump = true;
    if(flag === "paw") player.canPaw = true;
    if(flag === "crouch") player.canCrouch = true;
    if(flag === "bite") player.canBite = true;
  }
  // Handle "resetQuest" node property (resets all quest state flags so the player can restart the quest)
  if (curNode.resetQuest) {
    player.questState.started = player.questState.complete = player.allCollected = player.questState.rewardClaimed = false;
    player.questState.npcName = undefined; player.collectableCount = 0;
    collectableGroupNodes.forEach(n => n.setEnabled(false)); // Re-hide all items so they respawn cleanly when quest restarts
  }
  // Handle "background" node (horizontal black bars for cinematic moments)
  if (curNode.background !== undefined) {ui.dialogOverlay.css("background",curNode.background);}
  // Handle "cameraTarget" node
  if (curNode.cameraTarget !== undefined) {
    pinCameraTo(curNode.cameraTarget);
  }
  // Handle "cameraAngles" node { alpha, beta, distance }
  if (curNode.cameraAngles !== undefined) {
    if (curNode.cameraAngles.yaw !== undefined) player.camera.alpha = curNode.cameraAngles.yaw;
    if (curNode.cameraAngles.pitch !== undefined) player.camera.beta = curNode.cameraAngles.pitch;
    if (curNode.cameraAngles.distance !== undefined) player.camera.radius = curNode.cameraAngles.distance;
  }

  /* Handle "title"/"subtitle" sequences SEPARATELY */
  if (curNode.title !== undefined || curNode.subtitle !== undefined) {
    showTitlecard(curNode.title, curNode.subtitle, true);
    await sleepCancellable(curNode.delay?curNode.delay:3000); // 3s default delay, if no delay specified
    if (dialogState.playing) await proceedDialog();
  }else{
    // Handle "character" node
    if (curNode.character !== undefined) {ui.charText.text(curNode.character.replace(/\{PLAYER\}/g, player.name));}
    // Handle "cutsceneBars" node (horizontal black bars for cinematic moments)
    if (curNode.cutsceneBars !== undefined) {dialogState.cutsceneBars = curNode.cutsceneBars;showCutsceneBars(dialogState.cutsceneBars);}
    // Handle "waitFor" node (waits for a game condition before auto-proceeding)
    if (curNode.waitFor !== undefined) {
      const nodePromise = handleWaitForNode(curNode.waitFor); // Start condition check immediately, in parallel with text
      showWaitForPrompt(); // Show condition progress indicator immediately as node starts
      if (curNode.text !== undefined) await printText(ui.dialogText, curNode.text, 1.0);
      await nodePromise;
      if (dialogState.playing) getUserInput(); // Condition met - show "Press spacebar" prompt, keyboard handler calls proceedDialog
    // Handle "choices" node (aka a question node)
    } else if (curNode.choices !== undefined) {
      dialogState.questionNode = true;
      await printText(ui.dialogText, curNode.text, 1.0);
      if (!dialogState.playing) return;
      dialogState.choices = curNode.choices;
      getUserInput(dialogState.choices);
    }else if(curNode.text !== undefined) { // Handle "text" node
      await printText(ui.dialogText, curNode.text, 1.0);
      if (!dialogState.playing) return;
      if (curNode.delay !== undefined) { // Auto-advance after delay, no spacebar prompt
        await sleepCancellable(curNode.delay);
        if (dialogState.playing) await proceedDialog();
      } else { getUserInput(); } // getUserInput gets spacebar press, in order to proceed to next dialog node
    }
  }
}
/** @desc Starts tracking a named waitFor condition and returns a Promise that resolves once all requirements are met */
async function handleWaitForNode(waitFor) {
  waitForCondition = waitFor; nodeRequirements = {};
  return new Promise(resolve => { // Create promise that has conditions which must resolve before proceeding to next dialog node
    resolveNode = resolve;
    const done = () => { showWaitForPrompt(); if (dialogState.printing) dialogState.instantPrint = true; if (cleanupNode) cleanupNode(); waitForCondition = undefined; cleanupNode = undefined; resolveNode = undefined; resolve(); };
    if (waitFor === 'crouch') { // Continue dialog once the player crouches AND uncrouches
      nodeRequirements = { hasCrouched: false, hasUncrouched: false };
      const observer = scene.onBeforeRenderObservable.add(() => {
        let changed = false;
        if (player.movement.isCrouching && !nodeRequirements.hasCrouched) { nodeRequirements.hasCrouched = true; changed = true; }
        if (!player.movement.isCrouching && nodeRequirements.hasCrouched && !nodeRequirements.hasUncrouched) { nodeRequirements.hasUncrouched = true; changed = true; }
        if (changed) showWaitForPrompt();
        if (nodeRequirements.hasCrouched && nodeRequirements.hasUncrouched) done();
      });
      cleanupNode = () => scene.onBeforeRenderObservable.remove(observer);
    } else if (waitFor === 'swat_all') { // Continue dialog once player does a plain swat, fast swat, and slow swat
      nodeRequirements = { hasSwiped: false, hasFastSwatted: false, hasSlowSwatted: false };
      const observer = scene.onBeforeRenderObservable.add(() => {
        let changed = false;
        if (player.swatting && !nodeRequirements.hasSwiped) { nodeRequirements.hasSwiped = true; changed = true; }
        if (player.swatting && player.movement.isSprinting && !nodeRequirements.hasFastSwatted) { nodeRequirements.hasFastSwatted = true; changed = true; }
        if (player.swatting && player.movement.isWalking  && !nodeRequirements.hasSlowSwatted)  { nodeRequirements.hasSlowSwatted  = true; changed = true; }
        if (changed) showWaitForPrompt();
        if (nodeRequirements.hasSwiped && nodeRequirements.hasFastSwatted && nodeRequirements.hasSlowSwatted) done();
      });
      cleanupNode = () => scene.onBeforeRenderObservable.remove(observer);
    } else if (waitFor.startsWith('jump:')) { // Continue once player jumps high enough (tracks peak height from liftoff to landing)
      nodeRequirements = { jumped: false };
      const required = parseFloat(waitFor.split(':')[1]);
      let jumpStartY = undefined, peakY = undefined, wasOnGround = player.onGround;
      const interval = setInterval(() => {
        const nowOnGround = player.onGround;
        if (wasOnGround && !nowOnGround) { // Liftoff detected
          jumpStartY = player.body.position.y; peakY = jumpStartY;
        } else if (!nowOnGround && jumpStartY !== undefined) { // In flight, track peak
          if (player.body.position.y > peakY) peakY = player.body.position.y;
        } else if (!wasOnGround && nowOnGround && jumpStartY !== undefined) { // Landing detected, evaluate height
          if (peakY - jumpStartY >= required) { nodeRequirements.jumped = true; done(); }
          else { jumpStartY = undefined; peakY = undefined; } // Not high enough, reset for retry
        }
        wasOnGround = nowOnGround;
      }, 16);
      cleanupNode = () => clearInterval(interval);
    } else if (waitFor === 'sprint_walk') { // Check if player sprints AND walks while moving
      nodeRequirements = { hasSprinted: false, hasWalked: false };
      const observer = scene.onBeforeRenderObservable.add(() => {
        let changed = false;
        if (player.movement.isSprinting && player.movement.isMoving && !nodeRequirements.hasSprinted) { nodeRequirements.hasSprinted = true; changed = true; }
        if (player.movement.isWalking  && player.movement.isMoving && !nodeRequirements.hasWalked)  { nodeRequirements.hasWalked  = true; changed = true; }
        if (changed) showWaitForPrompt();
        if (nodeRequirements.hasSprinted && nodeRequirements.hasWalked) { done(); }
      });
      cleanupNode = () => scene.onBeforeRenderObservable.remove(observer);
    } else if (waitFor === 'wasd') { // Check if player presses WASD keys (also for tutorial sequence)
      nodeRequirements = { KeyW: false, KeyA: false, KeyS: false, KeyD: false };
      const interval = setInterval(() => {
        let changed = false;
        for (const k of Object.keys(nodeRequirements)) {
          if (keysDown[k] && !nodeRequirements[k]) { nodeRequirements[k] = true; changed = true; }
        }
        if (changed) showWaitForPrompt();
        if (Object.values(nodeRequirements).every(Boolean)) { clearInterval(interval); done(); }
      }, 50);
      cleanupNode = () => clearInterval(interval);
    } else if (waitFor === 'cam360') { // Check for player moving camera around in all directions (for tutorial sequence!)
      nodeRequirements = { lookLeft: false, lookRight: false, lookDown: false, lookUp: false };
      let prevAlpha = player.camera.alpha, prevBeta = player.camera.beta;
      const observer = player.camera.onAfterCheckInputsObservable.add(() => {
        const dAlpha = player.camera.alpha - prevAlpha, dBeta = player.camera.beta - prevBeta, moveThreshold = 0.01;
        prevAlpha = player.camera.alpha; prevBeta = player.camera.beta;
        let changed = false;
        if (dAlpha > moveThreshold && !nodeRequirements.lookLeft) { nodeRequirements.lookLeft = true; changed = true; }
        if (dAlpha < -moveThreshold && !nodeRequirements.lookRight) { nodeRequirements.lookRight = true; changed = true; }
        if (dBeta < -moveThreshold && !nodeRequirements.lookDown) { nodeRequirements.lookDown = true; changed = true; }
        if (dBeta > moveThreshold && !nodeRequirements.lookUp) { nodeRequirements.lookUp = true; changed = true; }
        if (changed) showWaitForPrompt();
        if (nodeRequirements.lookLeft && nodeRequirements.lookRight && nodeRequirements.lookDown && nodeRequirements.lookUp) { done(); }
      });
      cleanupNode = () => player.camera.onAfterCheckInputsObservable.remove(observer);
    } else if (waitFor === 'bite') {
      nodeRequirements = { hasBit: false };
      const observer = scene.onBeforeRenderObservable.add(() => {
        if (player.biteTarget !== undefined) { nodeRequirements.hasBit = true; done(); }
      });
      cleanupNode = () => scene.onBeforeRenderObservable.remove(observer);
    } else if (waitFor === 'itemShowcase' || waitFor === 'remainingItems') {
      const isItemShowcase = waitFor === 'itemShowcase';
      const collectables = isItemShowcase ? collectableGroupNodes : collectableGroupNodes.filter(n => n.isEnabled());
      nodeRequirements = { curItemIndex: 0, total: collectables.length, showcaseComplete: false };
      if (collectables.length === 0) { done(); return; }
      if (isItemShowcase) collectables[0].setEnabled(true);
      pinCameraTo(collectables[0]);
      showWaitForPrompt();
      nextNode = () => {
        nodeRequirements.curItemIndex++;
        if (nodeRequirements.curItemIndex >= collectables.length) {
          if (isItemShowcase) player.questState.started = true;
          nodeRequirements.showcaseComplete = true; done(); return;
        }
        if (isItemShowcase) collectables[nodeRequirements.curItemIndex].setEnabled(true);
        pinCameraTo(collectables[nodeRequirements.curItemIndex]);
        showWaitForPrompt();
      };
      cleanupNode = () => { nextNode = undefined; };
    } else { console.warn("handleWaitForNode: unknown waitFor condition '" + waitFor + "', resolving..."); done(); } // If unknown condition, resolve
  });
}
/** @desc Updates the on-screen waitFor progress indicator to reflect the current condition state. Hides the prompt if no waitFor condition is active */
function showWaitForPrompt() {
  if (!waitForCondition || !dialogState.playing) { ui.nodePromptElem.hide(); return; }
  const state = nodeRequirements, ico = (bool) => bool?"✅":"⏳"; // Tiny function to return correct emoji according to boolean status
  let html = '';
  if (waitForCondition === 'cam360') { html = "Look around in all directions!<br>"+ico(state.lookLeft)+" Left &nbsp; "+ico(state.lookRight)+" Right &nbsp; "+ico(state.lookUp)+" Up &nbsp; "+ico(state.lookDown)+" Down"; }
  else if (waitForCondition === 'wasd') { html = "Move around using the WASD keys!<br>"+ico(state.KeyW)+" W &nbsp; "+ico(state.KeyA)+" A &nbsp; "+ico(state.KeyS)+" S &nbsp; "+ico(state.KeyD)+" D"; }
  else if (waitForCondition === 'sprint_walk') { html = "Sprint using Left Shift, Walk using Left Alt<br>"+ico(state.hasSprinted)+" Sprint &nbsp; "+ico(state.hasWalked)+" Walk"; }
  else if (waitForCondition === 'crouch') { html = ico(state.hasCrouched)+" Press C to crouch! &nbsp; "+ico(state.hasUncrouched)+" Press C again to stand back up!"; }
  else if (waitForCondition === 'swat_all') { html = ico(state.hasSwiped)+" LMB: Swat &nbsp; "+ico(state.hasFastSwatted)+" Shift+LMB: Faster swat &nbsp; "+ico(state.hasSlowSwatted)+" Alt+LMB: Slower swat"; }
  else if (waitForCondition === 'bite') { html = ico(state.hasBit)+" Hold Right Mouse to bite and pull!"; }
  else if (waitForCondition.startsWith('jump:')) { html = ico(state.jumped)+" Hold spacebar to build up your jump height. Charge your jump all the way to continue!"; }
  else if (waitForCondition === 'itemShowcase' || waitForCondition === 'remainingItems') {
    if (state.showcaseComplete) {
      html = (waitForCondition === 'remainingItems') ? "Checked all remaining spots!" : "All items spotted!";
    } else {
      html = "Item " + (state.curItemIndex + 1) + " of " + state.total + " &nbsp;-&nbsp; Press Spacebar to " + ((state.curItemIndex + 1) < state.total ? "view next" : "continue");
    }
  }
  ui.nodePromptElem.html(html).show();
}
/** @desc Called by inputs.js when the proceedDialog key is pressed. Fires the active showcase advance callback if one is set and text is not currently printing */
export function showNextItem() { if (nextNode && !dialogState.printing) nextNode(); }
/** @desc Shows or hides the cinematic black bars at the very top and bottom of the screen during ingame dialog or cinematics */
function showCutsceneBars (show=true) { if(show) { ui.cutsceneBarElem.show(); } else { ui.cutsceneBarElem.hide(); } }
/** @desc Sets the titlecard overlay's title and subtitle text. `showBG` controls whether the overlay background is black (`true`) or transparent (`false`) */
function showTitlecard (title, subtitle, showBG=true) {
  ui.dialogOverlay.css("background",showBG?"black":"transparent");
  ui.titleText.text(title);ui.subtitleText.text(subtitle);
}
/** @desc Returns a `Promise` that resolves after `ms` milliseconds, bare unconditional primitive, no dialog-state awareness */
async function sleepRaw(ms) {return new Promise(resolve => setTimeout(resolve, ms));}
/** @desc Like sleepRaw(), but polls every 50ms and exits early if dialog is force-ended mid-wait. Use this for long unguarded delays (e.g. titlecard holds) */
async function sleepCancellable(ms) {
  const step = 50, end = performance.now() + ms;
  while (dialogState.playing && performance.now() < end) { await sleepRaw(Math.min(step, end - performance.now())); }
}
/** @desc Prints `text` into `element` one character at a time at `dialogSpeed * speed` ms per character. Respects pause, instant-print (Space to skip), and dialog-end interruptions */
async function printText(element, text, speed = 1.0) {
  if(!text || !element) return;
  // Substitute runtime collectable values so dialog text can reference them dynamically
  text = text.replace(/\{REMAINING}/g, totalCollectibles - player.collectableCount).replace(/\{TOTAL}/g, totalCollectibles).replace(/\{PLAYER}/g, player.name);
  dialogState.printing = true;
  let tempText = '';
  for (let i = 0; i < text.length; i++) {
    if (!dialogState.playing) break; // Exit immediately if dialog was force-ended
    if (dialogState.instantPrint) { element.html(text.replace(/\n/g, '<br>')); break; }
    while (dialogState.paused) { await sleepRaw(100); }
    tempText += text[i] + ''; element.html(tempText.replace(/\n/g, '<br>'));
    await sleepRaw(speed * dialogSpeed / (player.movement.isJumpBtnDown ? 4 : 1));
  }
  dialogState.printing = dialogState.instantPrint = false;
}
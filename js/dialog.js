import {game, player, scene} from "./globals.js";
import {pinCameraTo} from "./utils.js";

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

const dialogOverlay = $(".cutsceneOverlay"), dialogText = $(".dialogText"), charText = $(".charText"), choicesElem = $("ul.dialogChoices");
const cutsceneBarElem = $(".cutsceneOverlay .dialogBar"), titleText = $(".titlecardText"), subtitleText = $(".subtitleText");
const conditionPromptElem = $(".conditionPrompt");

const dialogState = {
  playing: false,
  paused: false,
  inputEnabled: false,
  questionNode: false,
  cutsceneBars: false,
  choices: [],
  printing: false,
  instantPrint: false,
};
/** @desc Returns `true` if a dialog sequence is currently active */
export function isDialogPlaying(){return dialogState.playing;}
/** @desc Returns `true` if the active dialog has been paused */
export function isDialogPaused(){return dialogState.paused;}
/** @desc Returns `true` if the dialog system is currently awaiting player input (spacebar or choice key) */
export function isInputEnabled(){return dialogState.inputEnabled;}
/** @desc Returns the current array of dialog choice objects for the active question node */
export function getDialogChoices(){return dialogState.choices;}
/** @desc Returns the current waitFor condition string, or null if none is active */
export function getActiveCondition(){return activeCondition;}
/** @desc Pauses the active dialog, hides the cutscene bars, overlay, and condition prompt without ending the sequence */
export function pauseDialog(){dialogState.paused = true;showCutsceneBars(false);dialogOverlay.hide();conditionPromptElem.hide();}
/** @desc Resumes a paused dialog, restoring cutscene bars, the overlay, and the condition prompt if a `waitFor` condition is still active */
export function resumeDialog() {dialogState.paused = false;showCutsceneBars(dialogState.cutsceneBars);game.curMenu = "cutscene";dialogOverlay.show();if(activeCondition)updateConditionPrompt();}
let camTargetChanged = false, dialogPromise, couldMove, couldJump, couldPaw, couldCrouch, couldBite, conditionCleanup = null, conditionResolve = null, activeCondition = null, conditionState = {};
let persistEnabled = new Set(); // Abilities unlocked mid-dialog persist across all subsequent nodes
let dialogJSON, dialogResolve = null, curDialogNode = '', dialogSpeed = 50/*ms per letter*/;
/** @desc Returns `true` if dialog text is currently being printed character by character */
export function isTextPrinting(){return dialogState.printing;}
/** @desc Updates the on-screen condition progress indicator (`conditionPromptElem`) to reflect the current state of the active `waitFor` condition. Hides the prompt if no condition is active */
function updateConditionPrompt() {
  if (!activeCondition || !dialogState.playing) { conditionPromptElem.hide(); return; }
  const state = conditionState, ico = (bool) => bool?'✅':'⏳'; // Tiny function to return correct emoji according to boolean status
  let html = '';
  if (activeCondition === 'cam360') { html = "Look around in all directions!<br>"+ico(state.lookLeft)+" Left &nbsp; "+ico(state.lookRight)+" Right &nbsp; "+ico(state.lookUp)+" Up &nbsp; "+ico(state.lookDown)+" Down"; }
  else if (activeCondition === 'wasd') { html = "Move around using the WASD keys!<br>"+ico(state.KeyW)+" W &nbsp; "+ico(state.KeyA)+" A &nbsp; "+ico(state.KeyS)+" S &nbsp; "+ico(state.KeyD)+" D"; }
  else if (activeCondition === 'sprint_walk') { html = "Sprint using Left Shift, Walk using Left Alt<br>"+ico(state.hasSprinted)+" Sprint &nbsp; "+ico(state.hasWalked)+" Walk"; }
  else if (activeCondition === 'swat') { html = ico(state.swiped)+" Hold Left Mouse button down to swat your paw!"; }
  else if (activeCondition === 'crouch') { html = ico(state.hasCrouched)+" Hold C to crouch!"; }
  else if (activeCondition === 'swat_modifiers') { html = ico(state.hasFastSwatted)+" Shift+LMB: Faster swat &nbsp; "+ico(state.hasSlowSwatted)+" Alt+LMB: Slower swat"; }
  else if (activeCondition === 'bite') { html = ico(state.hasBit)+" Hold Right Mouse to bite and pull!"; }
  else if (activeCondition.startsWith('jump:')) { html = ico(state.jumped)+" Press spacebar to jump. Hold spacebar to jump higher!"; }
  conditionPromptElem.html(html).show();
}

/** @desc Takes a string "path" value to specify which .json file to parse (with added optional "startNodeOverride" parameter) */
export async function startDialog(path='./res/dialog/dialog.json', startNodeOverride) {
  if(dialogState.playing || dialogState.paused){console.error("Dialog already playing, cannot start dialog...");return Promise.resolve();}
  // Creates return promise and ties resolve to dialogResolve (ideally resolved when endDialog() called)
  dialogPromise = new Promise(resolve => { dialogResolve = resolve; });
  try {
    const resp = await fetch(path); dialogJSON = await resp.json();
    if(!resp.ok || !dialogJSON || dialogJSON.nodes === undefined){console.error('Failed to load dialog JSON data, cannot start dialog...');return Promise.resolve();}
    let startNodeName = startNodeOverride || dialogJSON.start || Object.keys(dialogJSON.nodes)[0];
    if(!startNodeName){console.error('No valid "start" node found in dialog JSON, cannot start dialog...');return Promise.resolve();}
    game.curMenu = "cutscene";
    couldMove = player.movement.canMove; couldJump = player.canJump; couldPaw = player.canPaw; couldCrouch = player.canCrouch; couldBite = player.canBite;
    player.movement.canMove = false; player.canJump = false; player.canPaw = false; player.canCrouch = false; player.canBite = false;
    persistEnabled = new Set();
    curDialogNode = dialogJSON.nodes[startNodeName];
    dialogState.playing = true; dialogState.paused = false;
    dialogOverlay.show();
    await handleDialogNode(curDialogNode);
    return dialogPromise; // This will resolve when endDialog calls dialogResolve()
  } catch (error) { console.error('Dialog error:', error.message); endDialog(); return Promise.reject(error); }
}

/** @desc Takes a number (1-9) and handles which dialog node to proceed to. If no "next" value found, endDialog() is called */
export async function handleQuestionNode(key){
  if (!dialogState.playing) return;
  let curChoice = curDialogNode.choices[key-1]; if(!curChoice)return;
  curDialogNode = dialogJSON.nodes[curChoice.next];
  // End dialog if no "next" node found
  if(!curDialogNode) { endDialog(); } else { // Otherwise, handle the next dialog node
    dialogState.choices = [];
    choicesElem.empty(); // Clear the choicesElem of dialog choice elements
    dialogState.inputEnabled = dialogState.questionNode = false;
    await handleDialogNode(curDialogNode);
  }
}

/** @desc Processes a single dialog node object, resets UI state, applies node properties (title, text, camera, cutsceneBars, enable, waitFor, choices), and awaits player input or condition resolution before returning */
async function handleDialogNode(curNode) {
  if (!curNode) {console.error("No valid node detected, dialog interrupted!");endDialog();return;}
  /* Reset SOME on-screen elements each time a new dialog node is processed: */
  showTitlecard('', '', false); // Reset titlecard
  charText.text(''); conditionPromptElem.hide(); // Reset character text and condition prompt
  // Reset all player abilities, add this node's flags to the persistent set, then apply everything unlocked so far
  player.movement.canMove = false; player.canJump = false; player.canPaw = false; player.canCrouch = false;
  if (curNode.enable !== undefined) for (const flag of curNode.enable) persistEnabled.add(flag);
  for (const flag of persistEnabled) {
    if(flag === "move")   player.movement.canMove = true;
    if(flag === "jump")   player.canJump = true;
    if(flag === "paw")    player.canPaw = true;
    if(flag === "crouch") player.canCrouch = true;
    if(flag === "bite")   player.canBite = true;
  }
  // Handle "background" node (horizontal black bars for cinematic moments)
  if (curNode.background !== undefined) {dialogOverlay.css("background",curNode.background);}
  // Handle "cameraTarget" node
  if (curNode.cameraTarget !== undefined) {
    camTargetChanged = true;
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
    if (curNode.character !== undefined) {charText.text(curNode.character);}
    // Handle "cutsceneBars" node (horizontal black bars for cinematic moments)
    if (curNode.cutsceneBars !== undefined) {dialogState.cutsceneBars = curNode.cutsceneBars;showCutsceneBars(dialogState.cutsceneBars);}
    // Handle "waitFor" node (waits for a game condition before auto-proceeding)
    if (curNode.waitFor !== undefined) {
      const conditionPromise = awaitCondition(curNode.waitFor); // Start condition check immediately, in parallel with text
      updateConditionPrompt(); // Show condition progress indicator immediately as node starts
      if (curNode.text !== undefined) await printText(dialogText, curNode.text, 1.0);
      await conditionPromise;
      if (dialogState.playing) getInput(); // Condition met - show "Press spacebar" prompt, keyboard handler calls proceedDialog
    // Handle "choices" node (aka a question node)
    } else if (curNode.choices !== undefined) {
      dialogState.questionNode = true;
      await printText(dialogText, curNode.text, 1.0);
      if (!dialogState.playing) return;
      dialogState.choices = curNode.choices;
      getInput(dialogState.choices);
    }else if(curNode.text !== undefined) { // Handle "text" node
      await printText(dialogText, curNode.text, 1.0);
      if (dialogState.playing) getInput();
    }
  }
}

/** @desc Enables dialog input and populates the choices list with numbered options. If no `questions` array is provided, shows a "Press spacebar to continue" prompt instead */
function getInput(questions){
  dialogState.inputEnabled = true; // Enable key inputs (utilized in `input.js`)
  if(questions){ // Asking user for dialog input
    for (let curChoice in questions) {
      let choiceNum = (Number)(curChoice) + 1;
      choicesElem.append("<li class='dialogAnswer'>" + choiceNum + " - " + questions[curChoice].text + "</li>");
    }
  }else{ // Asking user for spacebar, to simply proceed dialog
    choicesElem.append("<li class='continue'>Press spacebar to continue...</li>");
  }
}
/** @desc Advances to the next dialog node specified by `curDialogNode.next`. Ends dialog if no next node exists */
export async function proceedDialog() {
  if (!dialogState.playing) return;
  let nextDialogNode = dialogJSON.nodes[curDialogNode.next];
  if (!nextDialogNode) { endDialog(); return; } // If no nextDialogNode, endDialog(), otherwise...
  dialogState.inputEnabled = false;
  choicesElem.empty();
  await handleDialogNode(curDialogNode = nextDialogNode); // Handle & assign nextDialogNode
}

/** @desc Waits for a named game condition before resolving. Used by dialog nodes with a "waitFor" property.
 * Supported `condStr` values: "cam360" - move camera in all directions, "wasd" - press WASD, "jumps:N" - player jumps N times */
async function awaitCondition(condStr) {
  activeCondition = condStr; conditionState = {};
  return new Promise(resolve => { // Create promise that has conditions which must resolve before proceeding to next dialog node
    conditionResolve = resolve;
    const done = () => { if (dialogState.printing) dialogState.instantPrint = true; if (conditionCleanup) conditionCleanup(); activeCondition = null; conditionCleanup = null; conditionResolve = null; resolve(); };
    if (condStr === 'crouch') { // Continue dialog once the player crouches
      conditionState = { hasCrouched: false };
      const observer = scene.onBeforeRenderObservable.add(() => { if(player.movement.isCrouching){ conditionState.hasCrouched = true; updateConditionPrompt(); done(); } });
      conditionCleanup = () => scene.onBeforeRenderObservable.remove(observer);
    } else if (condStr === 'swat') { // Continue dialog if player swats
      conditionState = { swiped: false };
      const observer = scene.onBeforeRenderObservable.add(() => { if(player.swatting){ conditionState.swiped = true; updateConditionPrompt(); done(); } });
      conditionCleanup = () => scene.onBeforeRenderObservable.remove(observer);
    } else if (condStr.startsWith('jump:')) { // Check if the player jumps with at least N jump velocity (before proceeding to next node)
      conditionState = { jumped: false };
      const required = parseFloat(condStr.split(':')[1]), startCount = player.jumpCount;
      const observer = scene.onBeforeRenderObservable.add(() => { if(player.jumpCount > startCount && player.lastJumpVelocity >= required){ conditionState.jumped = true; updateConditionPrompt(); done(); } });
      conditionCleanup = () => scene.onBeforeRenderObservable.remove(observer);
    } else if (condStr === 'sprint_walk') { // Check if player sprints AND walks while moving
      conditionState = { hasSprinted: false, hasWalked: false };
      const observer = scene.onBeforeRenderObservable.add(() => {
        let changed = false;
        if (player.movement.isSprinting && player.movement.isMoving && !conditionState.hasSprinted) { conditionState.hasSprinted = true; changed = true; }
        if (player.movement.isWalking  && player.movement.isMoving && !conditionState.hasWalked)  { conditionState.hasWalked  = true; changed = true; }
        if (changed) updateConditionPrompt();
        if (conditionState.hasSprinted && conditionState.hasWalked) { done(); }
      });
      conditionCleanup = () => scene.onBeforeRenderObservable.remove(observer);
    } else if (condStr === 'wasd') { // Check if player presses WASD keys (also for tutorial sequence)
      conditionState = { KeyW: false, KeyA: false, KeyS: false, KeyD: false };
      const handler = (e) => {
        if (e.code in conditionState && !conditionState[e.code]) {
          conditionState[e.code] = true; updateConditionPrompt();
          if (Object.values(conditionState).every(Boolean)) { done(); }
        }
      };
      window.addEventListener('keydown', handler);
      conditionCleanup = () => window.removeEventListener('keydown', handler);
    } else if (condStr === 'cam360') { // Check for player moving camera around in all directions (for tutorial sequence!)
      conditionState = { lookLeft: false, lookRight: false, lookDown: false, lookUp: false };
      let prevAlpha = player.camera.alpha, prevBeta = player.camera.beta;
      const observer = player.camera.onAfterCheckInputsObservable.add(() => {
        const dAlpha = player.camera.alpha - prevAlpha, dBeta = player.camera.beta - prevBeta, moveThreshold = 0.01;
        prevAlpha = player.camera.alpha; prevBeta = player.camera.beta;
        let changed = false;
        if (dAlpha > moveThreshold && !conditionState.lookLeft) { conditionState.lookLeft = true; changed = true; }
        if (dAlpha < -moveThreshold && !conditionState.lookRight) { conditionState.lookRight = true; changed = true; }
        if (dBeta < -moveThreshold && !conditionState.lookDown) { conditionState.lookDown = true; changed = true; }
        if (dBeta > moveThreshold && !conditionState.lookUp) { conditionState.lookUp = true; changed = true; }
        if (changed) updateConditionPrompt();
        if (conditionState.lookLeft && conditionState.lookRight && conditionState.lookDown && conditionState.lookUp) { done(); }
      });
      conditionCleanup = () => player.camera.onAfterCheckInputsObservable.remove(observer);
    } else if (condStr === 'swat_modifiers') {
      conditionState = { hasFastSwatted: false, hasSlowSwatted: false };
      const observer = scene.onBeforeRenderObservable.add(() => {
        let changed = false;
        if (player.swatting && player.movement.isSprinting && !conditionState.hasFastSwatted) { conditionState.hasFastSwatted = true; changed = true; }
        if (player.swatting && player.movement.isWalking  && !conditionState.hasSlowSwatted)  { conditionState.hasSlowSwatted  = true; changed = true; }
        if (changed) updateConditionPrompt();
        if (conditionState.hasFastSwatted && conditionState.hasSlowSwatted) done();
      });
      conditionCleanup = () => scene.onBeforeRenderObservable.remove(observer);
    } else if (condStr === 'bite') {
      conditionState = { hasBit: false };
      const observer = scene.onBeforeRenderObservable.add(() => {
        if (player.isBiting) { conditionState.hasBit = true; updateConditionPrompt(); done(); }
      });
      conditionCleanup = () => scene.onBeforeRenderObservable.remove(observer);
    } else { console.warn('awaitCondition: "' + condStr + '" unknown, resolving...'); done(); } // If unknown condition, resolve
  });
}
/** @desc Fully terminates the active dialog sequence, cleans up observers, resets all dialog state, restores the player's pre-dialog movement/jump/paw abilities, hides UI elements, and resolves the promise returned by `startDialog()` */
export function endDialog(){
  // Restore camera target if we changed it
  if (camTargetChanged && player.camera) { pinCameraTo(null); camTargetChanged = false; }
  // Clean up any active waitFor condition observer and unblock any pending await
  if (conditionCleanup) { conditionCleanup(); conditionCleanup = null; }
  if (conditionResolve) { conditionResolve(); conditionResolve = null; } activeCondition = null;
  dialogState.paused = dialogState.playing = dialogState.inputEnabled = dialogState.printing = dialogState.instantPrint = false;
  dialogJSON = null; curDialogNode = '';
  showCutsceneBars(false);showTitlecard('','',false);
  dialogText.text('');charText.text('');choicesElem.empty();conditionPromptElem.hide();
  if(dialogResolve){dialogResolve();dialogResolve = null;}
  dialogPromise = null;
  player.movement.canMove = couldMove; player.canJump = couldJump; player.canPaw = couldPaw; player.canCrouch = couldCrouch; player.canBite = couldBite;
}

/** @desc Prints `text` into `element` one character at a time at `dialogSpeed * speed` ms per character. Respects pause, instant-print (Space to skip), and dialog-end interruptions */
async function printText(element, text, speed = 1.0) {
  if(!text || !element) return;
  dialogState.printing = true;
  let tempText = '';
  for (let i = 0; i < text.length; i++) {
    if (!dialogState.playing) break; // Exit immediately if dialog was force-ended
    if (dialogState.instantPrint) { element.html(text.replace(/\n/g, '<br>')); break; }
    while (dialogState.paused) { await sleepRaw(100); }
    tempText += text[i] + ''; element.html(tempText.replace(/\n/g, '<br>'));
    await sleepRaw(speed * dialogSpeed / (player.movement.isJumpBtnDown ? 4 : 1));
  }
  dialogState.printing = false;
  dialogState.instantPrint = false;
}
/** @desc Returns a `Promise` that resolves after `ms` milliseconds, bare unconditional primitive, no dialog-state awareness */
async function sleepRaw(ms) {return new Promise(resolve => setTimeout(resolve, ms));}
/** @desc Like sleepRaw(), but polls every 50ms and exits early if dialog is force-ended mid-wait. Use this for long unguarded delays (e.g. titlecard holds) */
async function sleepCancellable(ms) {
  const step = 50, end = performance.now() + ms;
  while (dialogState.playing && performance.now() < end) { await sleepRaw(Math.min(step, end - performance.now())); }
}

/** @desc Shows or hides the cinematic black bars at the very top and bottom of the screen during ingame dialog or cinematics */
function showCutsceneBars (show=true) { if(show) { cutsceneBarElem.show(); } else { cutsceneBarElem.hide(); } }
/** @desc Sets the titlecard overlay's title and subtitle text. `showBG` controls whether the overlay background is black (`true`) or transparent (`false`) */
function showTitlecard (title, subtitle, showBG=true) {
  dialogOverlay.css("background",showBG?"black":"transparent");
  titleText.text(title);subtitleText.text(subtitle);
}
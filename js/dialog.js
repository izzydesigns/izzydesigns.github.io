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
export function isDialogPlaying(){return dialogState.playing;}
export function isDialogPaused(){return dialogState.paused;}
export function isInputEnabled(){return dialogState.inputEnabled;}
export function getDialogChoices(){return dialogState.choices;}
export function pauseDialog(){dialogState.paused = true;showCutsceneBars(false);dialogOverlay.hide();conditionPromptElem.hide();}
export function resumeDialog() {dialogState.paused = false;showCutsceneBars(dialogState.cutsceneBars);game.curMenu = "cutscene";dialogOverlay.show();if(activeCondition)updateConditionPrompt();}
let camTargetChanged = false, dialogPromise, couldMove, couldJump, couldPaw, conditionCleanup = null, conditionResolve = null, activeCondition = null, conditionState = {};
let dialogJSON, dialogResolve = null, curDialogNode = '', dialogSpeed = 50/*ms per letter*/;
export function isTextPrinting(){return dialogState.printing;}
function updateConditionPrompt() {
  if (!activeCondition || !dialogState.playing) { conditionPromptElem.hide(); return; }
  const condState = conditionState;
  let html = '';
  if (activeCondition === 'cam360') { html = `Look around in all directions!<br>${condState.lookLeft?'✅':'⏳'} Left &nbsp; ${condState.lookRight?'✅':'⏳'} Right &nbsp; ${condState.lookUp?'✅':'⏳'} Up &nbsp; ${condState.lookDown?'✅':'⏳'} Down`; }
  else if (activeCondition === 'wasd') { html = `Move around using the WASD keys!<br>${condState.KeyW?'✅':'⏳'} W &nbsp; ${condState.KeyA?'✅':'⏳'} A &nbsp; ${condState.KeyS?'✅':'⏳'} S &nbsp; ${condState.KeyD?'✅':'⏳'} D`; }
  else if (activeCondition === 'sprint_walk') { html = `Sprint using Left Shift, Walk using Left Alt<br>${condState.hasSprinted?'✅':'⏳'} Sprint &nbsp; ${condState.hasWalked?'✅':'⏳'} Walk`; }
  else if (activeCondition === 'swat') { html = `${condState.swiped?'✅':'⏳'} Hold Left Mouse button down to swat your paw!`; }
  else if (activeCondition.startsWith('jump:')) { html = `${condState.jumped?'✅':'⏳'} Press spacebar to jump. Hold spacebar to jump higher!`; }
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
    couldMove = player.movement.canMove; couldJump = player.canJump; couldPaw = player.canPaw;
    player.movement.canMove = false; player.canJump = false; player.canPaw = false;
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

async function handleDialogNode(curNode) {
  if (!curNode) {console.error("No valid node detected, dialog interrupted!");endDialog();return;}
  /* Reset SOME on-screen elements each time a new dialog node is processed: */
  showTitlecard('', '', false); // Reset titlecard
  charText.text(''); conditionPromptElem.hide(); // Reset character text and condition prompt
  // Reset all player abilities to disabled by default, then re-enable only what this node specifies
  player.movement.canMove = false; player.canJump = false; player.canPaw = false;
  if (curNode.enable !== undefined) {
    for (const flag of curNode.enable) {
      if(flag === "move") player.movement.canMove = true;
      if(flag === "jump") player.canJump = true;
      if(flag === "paw") player.canPaw  = true;
    }
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
    await sleepInterruptible(curNode.delay?curNode.delay:3000); // 3s default delay, if no delay specified
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
    if (condStr === 'swat') { // Continue dialog if player swats
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
    } else { console.warn('awaitCondition: "' + condStr + '" unknown, resolving...'); done(); } // If unknown condition, resolve
  });
}
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
  player.movement.canMove = couldMove; player.canJump = couldJump; player.canPaw = couldPaw;
}

async function printText(element, text, speed = 1.0) {
  if(!text || !element) return;
  dialogState.printing = true;
  let tempText = '';
  for (let i = 0; i < text.length; i++) {
    if (!dialogState.playing) break; // Exit immediately if dialog was force-ended
    if (dialogState.instantPrint) { element.html(text.replace(/\n/g, '<br>')); break; }
    while (dialogState.paused) { await sleep(100); }
    tempText += text[i] + ''; element.html(tempText.replace(/\n/g, '<br>'));
    await sleep(speed * dialogSpeed / (player.movement.isJumpBtnDown ? 4 : 1));
  }
  dialogState.printing = false;
  dialogState.instantPrint = false;
}
async function sleep(ms) {return new Promise(resolve => setTimeout(resolve, ms));}
/** @desc Like sleep(), but exits early if dialog is force-ended mid-wait */
async function sleepInterruptible(ms) {
  const step = 50, end = performance.now() + ms;
  while (dialogState.playing && performance.now() < end) { await sleep(Math.min(step, end - performance.now())); }
}

/** @desc Shows or hides the cinematic black bars at the very top and bottom of the screen during ingame dialog or cinematics */
function showCutsceneBars (show=true) { if(show) { cutsceneBarElem.show(); } else { cutsceneBarElem.hide(); } }
function showTitlecard (title, subtitle, showBG=true) {
  dialogOverlay.css("background",showBG?"black":"transparent");
  titleText.text(title);subtitleText.text(subtitle);
}
import {game, player, scene} from "./globals.js";

const dialogOverlay = $(".cutsceneOverlay"), dialogText = $(".dialogText"), charText = $(".charText"), choicesElem = $("ul.dialogChoices");
const cutsceneBarElem = $(".cutsceneOverlay .dialogBar"), titleText = $(".titlecardText"), subtitleText = $(".subtitleText");

const dialogState = {
  playing: false,
  paused: false,
  inputEnabled: false,
  questionNode: false,
  cutsceneBars: false,
  choices: [],
};
export function isDialogPlaying(){return dialogState.playing;}
export function isDialogPaused(){return dialogState.paused;}
export function isInputEnabled(){return dialogState.inputEnabled;}
export function getDialogChoices(){return dialogState.choices;}
export function pauseDialog(){dialogState.paused = true;showCutsceneBars(false);dialogOverlay.hide();}
export function resumeDialog() {dialogState.paused = false;showCutsceneBars(dialogState.cutsceneBars);game.curMenu = "cutscene";dialogOverlay.show();}
let oldCamTarget = null, curCamTarget = null, dialogPromise, couldMove;
let dialogJSON, dialogResolve = null, curDialogNode = '', dialogSpeed = 50/*ms per letter*/;

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
 *     "choices": [array of {objects}] - Contains a list of "text/next" dialog options
 *       "text": "string" - Dialog option text (shown to the user in order)
 *       "next": "string" - Name of dialog node to jump to, if selected
 * */

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
    couldMove = player.movement.canMove; // Store previous "canMove" value to restore after dialog finishes
    player.movement.canMove = false; // Disable player movement during cutscene/dialog sequences
    curDialogNode = dialogJSON.nodes[startNodeName];
    dialogState.playing = true; dialogState.paused = false;
    dialogOverlay.show();
    await handleDialogNode(curDialogNode);
    return dialogPromise; // This will resolve when endDialog calls dialogResolve()
  } catch (error) { console.error('Dialog error:', error.message); endDialog(); return Promise.reject(error); }
}

/** @desc Takes a number (1-9) and handles which dialog node to proceed to. If no "next" value found, endDialog() is called */
export async function handleQuestionNode(key){
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
  //showCutsceneBars(cutsceneBars); // Reset cutscene bars (nevermind, toggle = convenient)
  charText.text(''); // Reset character text

  /* JSON Nodes to handle regardless of node type */
  // Handle "background" node (horizontal black bars for cinematic moments)
  if (curNode.background !== undefined) {dialogOverlay.css("background",curNode.background);}
  // Handle "cameraTarget" node
  if (curNode.cameraTarget !== undefined) {
    oldCamTarget = player.camera.targetMesh;
    curCamTarget = curNode.cameraTarget; //just grabs mesh string name
    if (typeof curCamTarget === "string") { // If targeting named mesh in scene
      console.log("ASSIGNING CAMERA TO MESH NAMED " + curCamTarget);
      const newTarget = scene.getNodeByName(curCamTarget==="player"?"camOffset":curCamTarget);
      // Checks if named mesh exists within scene, unless checking for "player" when we want "camOffset" instead
      if (newTarget) player.camera.setTarget(newTarget);
    } else if (typeof curCamTarget === "object") { // If specifying camera coordinates
      let setCamPos = new BABYLON.Vector3(curCamTarget[0], curCamTarget[1], curCamTarget[2]);
      console.log("ASSIGNING CAMERA TO POSITION " + setCamPos);
      player.camera.setTarget(setCamPos);
    }
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
    await sleep(curNode.delay?curNode.delay:3000); // 3s default delay, if no delay specified
    await proceedDialog();
  }else{
    // Handle "character" node
    if (curNode.character !== undefined) {charText.text(curNode.character);}
    // Handle "cutsceneBars" node (horizontal black bars for cinematic moments)
    if (curNode.cutsceneBars !== undefined) {dialogState.cutsceneBars = curNode.cutsceneBars;showCutsceneBars(dialogState.cutsceneBars);}
    // Handle "choices" node (aka a question node)
    if (curNode.choices !== undefined) { // Handle question dialog node
      dialogState.questionNode = true;
      await printText(dialogText, curNode.text, 1.0);
      dialogState.choices = curNode.choices;
      getInput(dialogState.choices);
    }else if(curNode.text !== undefined) { // Handle "text" node
      await printText(dialogText, curNode.text, 1.0);
      getInput();
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
  let nextDialogNode = dialogJSON.nodes[curDialogNode.next];
  if (!nextDialogNode) { endDialog(); return; } // If no nextDialogNode, endDialog(), otherwise...
  dialogState.inputEnabled = false;
  choicesElem.empty();
  await handleDialogNode(curDialogNode = nextDialogNode); // Handle & assign nextDialogNode
}
export function endDialog(){
  // Restore camera target if we changed it
  if (oldCamTarget && player.camera) {player.camera.setTarget(oldCamTarget);}
  dialogState.paused = dialogState.playing = dialogState.inputEnabled = false;
  oldCamTarget =  curCamTarget = dialogJSON = null;curDialogNode = '';
  showCutsceneBars(false);showTitlecard('','',false);
  dialogText.text('');charText.text('');choicesElem.empty();
  if(dialogResolve){dialogResolve();dialogResolve = null;}
  dialogPromise = null;
  player.movement.canMove = couldMove;
}

// Code for printing dialog text to the screen, rather than instantly displaying it!
// TODO: Add a bypass boolean that skips to the end of the dialog line when a "skip" button/key is pressed
async function printText(element, text, speed = 1.0) {
  if(!text || !element) return;
  let tempText = '';
  for (let i = 0; i < text.length; i++) {
    while (dialogState.paused) { await sleep(100); } // If dialogPaused, wait before continuing
    tempText += text[i] + ''; element.text(tempText);
    await sleep(speed * dialogSpeed); // Pause/sleep to simulate a "typing" effect, await used for .then() later on
  }
}
async function sleep(ms) {return new Promise(resolve => setTimeout(resolve, ms));}

/** @desc Shows or hides the cinematic black bars at the very top and bottom of the screen during ingame dialog or cinematics */
function showCutsceneBars (show=true) { if(show) { cutsceneBarElem.show(); } else { cutsceneBarElem.hide(); } }
function showTitlecard (title, subtitle, showBG=true) {
  dialogOverlay.css("background",showBG?"black":"transparent");
  titleText.text(title);subtitleText.text(subtitle);
}
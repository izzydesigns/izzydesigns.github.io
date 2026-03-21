// NOTE: This file only serves as a way to share variables across other files
// Anything imported here, should NOT import this file as a result!!! (avoid circular dependencies).

export const ui = {
  // Menu screens
  mainMenu: $("#menus .mainMenu"),
  ingameHUDMenu: $("#menus .ingameHUDMenu"),
  pauseMenu: $("#menus .pauseMenu"),
  settingsMenu: $("#menus .settingsMenu"),
  customizationMenu: $("#menus .customizationMenu"),
  cutsceneOverlayMenu: $("#menus .cutsceneOverlay"),
  // Settings menu elements
  settings_walkInput: $("#menus .settingsMenu #moveSpeed"),
  settings_applyWalkBtn: $("#menus .settingsMenu .walkApply"),
  settings_sprintInput: $("#menus .settingsMenu #sprintSpeed"),
  settings_applySprintBtn: $("#menus .settingsMenu .sprintApply"),
  settings_jumpInput: $("#menus .settingsMenu #jumpHeight"),
  settings_applyJumpBtn: $("#menus .settingsMenu .jumpApply"),
  settings_debugLabel: $("#menus .settingsMenu .debugMode"),
  settings_debugBtn: $("#menus .settingsMenu .debugToggle"),
  settings_backBtn: $("#menus .settingsMenu .back"),
  // Customization menu elements
  customize_nameInput: $("#menus .customizationMenu .playerName"),
  customize_finishBtn: $("#menus .customizationMenu .finishCreation"),
  customize_selectFur: $("#menus .customizationMenu #fur-color"),
  customize_rotateLeft: $("#menus .customizationMenu .rotateLeft"),
  customize_rotateRight: $("#menus .customizationMenu .rotateRight"),
  // Pause menu buttons
  pause_resumeBtn: $("#menus .pauseMenu .resume"),
  pause_controlsBtn: $("#menus .pauseMenu .controls"),
  pause_settingsBtn: $("#menus .pauseMenu .settings"),
  pause_mmBtn: $("#menus .pauseMenu .mainmenu"),
  // Main menu buttons
  mm_playBtn: $("#menus .mainMenu .play"),
  mm_settingsBtn: $("#menus .mainMenu .settings"),
  mm_exitBtn: $("#menus .mainMenu .exit"),
  // HUD elements
  hud1ValElem: $("#menus .ingameHUDMenu .value1"),
  hud2ValElem: $("#menus .ingameHUDMenu .value2"),
  hud3ValElem: $("#menus .ingameHUDMenu .value3"),
  hud4ValElem: $("#menus .ingameHUDMenu .value4"),
  hud5ValElem: $("#menus .ingameHUDMenu .value5"),
  hudXValElem: $("#menus .ingameHUDMenu .x_value"),
  hudYValElem: $("#menus .ingameHUDMenu .y_value"),
  hudZValElem: $("#menus .ingameHUDMenu .z_value"),
  speedProgressBar: $("#menus .ingameHUDMenu .progress-bar"),
  hudCollectibles: $("#menus .ingameHUDMenu .collectiblesCount"),
  npcPrompt: $("#menus .ingameHUDMenu .npcPrompt"),
  npcPromptName: $("#menus .ingameHUDMenu .npcPromptName"),
  controlsInfo: $("#menus .controlsInfo"),
  controlsInfo_dismissBtn: $("#menus .controlsInfo .controlsInfoDismiss"),
};
/** @desc Object containing raw `animationGroup` names, multiple animation names provided specify which animations have a follow-up animation that must be played upon completion */
export const animationData = {
  // Player animation list: [animationGroup.name, nextAnimation?]
  // TODO: Add ability to specify blendingSpeed values for each animation, i.e. idleSleep should be 0.025 but the default is 0.1
  // TODO: Add a way to specify custom start & stop frames (use percentage value from 0 to 100)
  crawl: ["cat_crawl"],
  crouchToStand: ["crouchA_toStandA", "cat_idleStandA"],
  gallop: ["cat_gallop"],
  idleCrouch: ["cat_idleCrouchA"],
  jumpHighIdle: ["cat_idleJumpHighReady"],
  idleLaying: ["cat_idleLayDown"],
  idleSit: ["cat_idleSitA"],
  idleSitClean: ["cat_idleSitClean"],
  idleSleep: ["cat_idleSleep"],
  idleStand: ["cat_idleStandA"],
  idleStandClean: ["cat_idleStandClean"],
  jump: ["cat_jump"],
  jumpHigh: ["cat_jumpHigh"],
  pull: ["cat_pull"],
  push: ["cat_push"],
  sitToStand: ["cat_sitA_toStandA", "cat_idleStandA"],
  standToCrouch: ["cat_standA_toCrouch", "cat_idleCrouchA"],
  standToGallop: ["cat_standA_toGallop", "cat_gallop"],
  standToJumpHighIdle: ["cat_standA_toJumpHighReady", "cat_idleJumpHighReady"],
  standToSit: ["cat_standA_toSit", "cat_idleSitA"],
  standToTrot: ["cat_standA_toTrot", "cat_trot"],
  standToWalk: ["cat_standA_toWalk", "cat_walk"],
  turnLeft180: ["cat_standA_turneLeft180", "cat_idleStandA"],
  turnLeft45: ["cat_standA_turnLeft45", "cat_idleStandA"],
  turnLeft90: ["cat_standA_turnLeft90", "cat_idleStandA"],
  turnRight180: ["cat_standA_turnRight180", "cat_idleStandA"],
  turnRight45: ["cat_standA_turnRight45", "cat_idleStandA"],
  turnRight90: ["cat_standA_turnRight90", "cat_idleStandA"],
  attack: ["cat_standAAttack", "cat_idleStandA"],
  trot: ["cat_trot"],
  walk: ["cat_walk"],
  walkToStand: ["cat_walk_toStandA", "cat_idleStandA"],
  walkToTrot: ["cat_walk_toTrot", "cat_trot"],
};
/** @desc This global variable contains the window's `#renderCanvas` element */
export const canvas = /** @type {HTMLCanvasElement} */ document.getElementById("renderCanvas");
/** @desc This global variable contains the scene's `BABYLON.Engine` object. Initialized immediately after the `canvas` variable has been fetched */
export let engine;
/** @desc This global variable contains the global scene variable used in all other files. This gets initialized right away as well, creating the default scene immediately */
export let scene;
/** @desc Setter for the `engine` object */
export function setEngine(desiredEngine){engine = desiredEngine;return engine;}
/** @desc Setter for the `scene` object */
export function setScene(desiredScene){scene = desiredScene;return scene;}
/** @desc This global variable contains all the relevant data for the game itself. This contains various important vars for things like the `game.time`, `game.paused`, and `game.currentFPS`, for example */
export const game = {
  time: performance.now(), lastFrameTime: 0, frameRateLimit: 1000/60, currentFPS: 0,
  curMenu: "", prevMenu: "",
  animations: [], // Object reference for all loaded scene animations
  lights: [], // Object reference for all scene lights
  paused: false, // Has the game been paused/unfocused/minimized
  pausedAt: 0, // Time when game was last paused (updated via `performance.now()`)
  resumeDelay: 1200, // Delay before re-enabling "Resume" button on pause screen (to avoid browser cursorlock safety policy errors)
  playerSkins: {
    default: "./res/skins/placeholder.png",
    white: "./res/skins/placeholder3.png",
    garfield: "./res/skins/placeholder2.png",
    naked: "./res/skins/placeholder4.png",
  },
  playerModels: {
    default: "./res/models/cat.glb",
    naked: "./res/models/skinny_cat.glb",
  }
};
/** @desc This global variable contains all the "default values" for various game settings. Used to keep all initialization values in one place, and also contains the `controls` object key which declares all the game's default keybinds */
export const gameSettings = {
  debugMode: false, // Toggles console debug messages
  engineSettings: { deterministicLockstep: true, lockstepMaxSteps: 4, antialias: true },
  controls: {
    devMenu: "Tab",
    forward: "KeyW", left: "KeyA", back: "KeyS", right: "KeyD",
    jump: "Space", sprint: "ShiftLeft", walk: "AltLeft",
    interact: "KeyE",
  },
  menus: {
    "main": ui.mainMenu,
    "ingame": ui.ingameHUDMenu,
    "pause": ui.pauseMenu,
    "settings": ui.settingsMenu,
    "customization": ui.customizationMenu,
    "controls": ui.controlsInfo,
    "cutscene": ui.cutsceneOverlayMenu, // previously titlecard
  },
  defaultMenu: "main", // Menu to be shown upon scene initialization
  defaultSpawnPoint: new BABYLON.Vector3(0,5,0), // Used if no "spawnpoint" data point is found when parsing level mesh
  defaultGravity: new BABYLON.Vector3(0, -9, 0), // Gravity value used when initializing game engine object
  defaultCamOffset: new BABYLON.Vector3(0,0.85,0),
  defaultCamDist: 3, defaultMinCamDist: 0.25, defaultMaxCamDist: 4,
  defaultMoveAccel: 0.05, defaultMoveBlend: 0.2, // defaultMoveBlend = lerp factor for ground velocity blending
  defaultMaxSlopeAngle: 35, defaultSlopeAngle: 25,
  defaultMoveSpeed: 3, defaultWalkSpeed: 1.5, defaultSprintSpeed: 5, // Default move, walk, and sprint speeds
  defaultJumpHeight: 3.5, defaultMinJumpHeight: 2,
  defaultJumpDelay: 0, // Delay before player can jump again (in seconds)
  defaultAfkDelay: 15000, // After 15 seconds, sleeping idle animation will play
  defaultIdleAnimation: animationData.idleStand, // Animation to initialize player model with
  defaultAnimBlendValue: 0.1, // Set to zero in order to disable animation blending & weights
  defaultCollectableRotSpeed: 0.5, // How fast collectables rotate (how much y value incremented per frame, in radians I believe)
  defaultRotationSpeed: 0.08, // player.body rotation slerp value
  defaultLineThickness: 0.005, // mesh.outline thickness
  defaultAirControl: 0.15,
};
/** @desc This global variable contains all the relevant data for the player's object. This also contains the `player.body` and `player.mesh` variables, which are used in various places */
export const player = {
  name: "Player",
  model: undefined, mesh: undefined, body: undefined, camera: undefined, camOffset: undefined,
  impostorOptions: { // Player collider properties
    mass: 3, friction: 0.3, restitution: 0
  },
  boundingBox: new BABYLON.Vector3(0.175, 0.4, 0.45), // Default size of `player.body` (scaled by bodyScale)
  bodyScale: 2.5, // Player scale TODO: broken (only working using "magic numbers", and 2.5 is one of them)
  movement: {
    canMove: true, canSprint: true,
    isMoving: false, isJumpBtnDown: false, isJumping: false,
    isWalking: false, isSprinting: false,
    forward: false, back: false, left: false, right: false,
  },
  jumpHeight: gameSettings.defaultJumpHeight,
  curMoveSpeed: gameSettings.defaultMoveSpeed,
  onGround: false, isSliding: false,
  cursorLocked: false, firstPerson: false,
  isAfk: false, lastMoveTime: 0, speed: 0,
  surfaceTiltDeg: 0, surfaceNormal: new BABYLON.Vector3(0, 1, 0),
  curSkin: game.playerSkins.default, curModel: game.playerModels.default,
  curAnimation: gameSettings.defaultIdleAnimation, isAnimTransitioning: false, lastAnimation: undefined,
  collectableCount: 0, allCollected: false,
  lastSwatTime: performance.now(), swatting: false,
  swatStrength: 3, jumpCount: 0,
  canJump: true, canPaw: true,
  chargeJumpDelay: 1000, // ms to reach full charged jump height from standing still
  jumpChargeStart: 0,   // timestamp (performance.now) when jump button was pressed
  lastJumpVelocity: 0,  // Y velocity applied on last jump (used by dialog jump: condition)
  respawnPoint: new BABYLON.Vector3(0,0,0),
  tutorialMode: true,
  curMode: "default", modes: ["default","zoomies","sneak"], // TODO: Implement me! :)
};
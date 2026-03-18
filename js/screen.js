import {game, player, gameSettings, canvas, scene, ui, engine} from "./globals.js";
import * as dialog from "./dialog.js";
import * as utils from "./utils.js";
import * as level from "./level.js";
import {applyPlayerTexture, teleportPlayer} from "./utils.js";

export let currentMenu = "";

/** @desc Initializes the `game.currentMenu` value to `gameSettings.defaultMenu` and various other screen elements like input element values */
export function initScreenElements () {
  // If adding translations/localizations, this would be the place to translate the game text
  game.curMenu = gameSettings.defaultMenu;
  showMenu(game.curMenu);
  updateScreenElements(game.curMenu);
  // Main menu input handlers
  ui.mm_playBtn.click(async () => {
    if(game.prevMenu === "pause") {
      game.curMenu = "ingame"; updateMenus();
      canvas.requestPointerLock();
      return;
    }
    engine.displayLoadingUI();
    await level.loadLevel(1);
    engine.hideLoadingUI();
    game.curMenu = "customization";updateMenus();
    player.camera.radius = 4; player.camera.alpha = Math.PI / 4; player.camera.beta = Math.PI / 2;
    scene.getMeshByName("camOffset").position.y -= 0.1;
  });
  ui.mm_settingsBtn.click(() => {game.curMenu = "settings";updateMenus();});
  ui.mm_exitBtn.click(() => {window.close();});
  // Pause menu input handlers
  ui.pause_resumeBtn.click(async () => {
    utils.resumeScene();
    if(dialog.isDialogPlaying() && dialog.isDialogPaused())dialog.resumeDialog();
    game.curMenu = (game.prevMenu === "customization" || game.prevMenu === "cutscene")?game.prevMenu:"ingame";updateMenus();
    canvas.requestPointerLock();
    canvas.focus();
    player.isAfk = false; player.lastMoveTime = performance.now();
  });
  ui.pause_settingsBtn.click(() => {game.curMenu = "settings";updateMenus();});
  ui.pause_mmBtn.click(() => {game.curMenu = "main";updateMenus();});
  // Settings menu input handlers
  ui.settings_backBtn.click(() => {if(game.curMenu !== game.prevMenu) {game.curMenu = game.prevMenu;updateMenus();}});
  ui.settings_debugBtn.click(() => {
    if (!scene.debugLayer.isVisible()) {
      gameSettings.debugMode = true;
      scene.debugLayer.show().then(() => {});
    } else {
      gameSettings.debugMode = false;
      scene.debugLayer.hide();
    }
  });
  ui.settings_applyWalkBtn.click(() => {
    let newWalkSpeed = Number(ui.settings_walkInput.val());
    gameSettings.defaultMoveSpeed = newWalkSpeed;
    player.curMoveSpeed = newWalkSpeed;
  });
  ui.settings_applySprintBtn.click(() => {
    let newSprintSpeed = Number(ui.settings_sprintInput.val());
    gameSettings.defaultSprintSpeed = newSprintSpeed;
  });
  ui.settings_applyJumpBtn.click(() => {
    let newJumpHeight = Number(ui.settings_jumpInput.val());
    gameSettings.defaultJumpHeight = newJumpHeight;
    player.jumpHeight = newJumpHeight;
  });
  // Customization menu input handlers
  ui.customize_finishBtn.click(() => {
    if(ui.customize_nameInput.val().length > 0){
      // Sanitize player.name before assigning (only allows letters/numbers and - _ symbols)
      player.name = ui.customize_nameInput.val().replace(/[^a-zA-Z0-9_-]/g, '');
      game.curMenu = "controls"; updateMenus();
    }else{ console.error("no player name specified, notify the user or something"); }
  });
  ui.controlsInfo_dismissBtn.click(async () => {
    game.curMenu = "ingame"; updateMenus();
    await canvas.requestPointerLock();
    canvas.focus(); // Ensures BabylonJS keyboard listeners receive input immediately without requiring a click
    player.camera.radius = gameSettings.defaultCamDist;
    scene.getMeshByName("camOffset").position.y += 0.1;
    teleportPlayer(player.respawnPoint); // Tele player to level respawn point
    player.isAfk = false; player.lastMoveTime = performance.now();
  });
  let rotateInterval = null;
  const stopRotate = () => { clearInterval(rotateInterval); rotateInterval = null; };
  ui.customize_rotateLeft.on('mousedown', () => { rotateInterval = setInterval(() => { player.camera.alpha -= 0.02; }, 16); });
  ui.customize_rotateRight.on('mousedown', () => { rotateInterval = setInterval(() => { player.camera.alpha += 0.02; }, 16); });
  $(document).on('mouseup', stopRotate);
  ui.customize_selectFur.on('change', function() {
    let selectedValue = $(this).val(), selectedText = $(this).find('option:selected').text();
    switch(selectedValue){
      case 'default':
        player.curSkin = game.playerSkins.default;
        break;
      case 'white':
        player.curSkin = game.playerSkins.white;
        break;
      case 'garfield':
        player.curSkin = game.playerSkins.garfield;
        break;
      case 'naked':
        player.curSkin = game.playerSkins.naked;
        // Skin requires different model to be loaded as well (see `game.playerModels.naked`)
        break;
    }
    applyPlayerTexture(player.model, player.curSkin);
  });
}
/** @desc Handles which menu to display when `currentMenu` value is changed */
export function updateMenus () {
  updateScreenElements(game.curMenu); // Updates on-screen values based on which menu is being displayed
  if(game.curMenu !== currentMenu) { // Handle changes to currentMenu variable (compared against last value stored)
    if(gameSettings.debugMode)console.log("Changing menus: ", game.curMenu);
    showMenu(game.curMenu); // Display the new menu
    game.prevMenu = currentMenu; // Store previous menu in `game.prevMenu` variable
    currentMenu = game.curMenu; // Update our local `currentMenu` variable to equal `game.curMenu`
    // After displaying a new menu, check if it's the pause menu & dialog is also playing... if so, pause dialog
    if(dialog.isDialogPlaying() && currentMenu === "pause"){dialog.pauseDialog();}
  }
}
/** @desc Handle dynamically updating values for UI elements (like the settings menu, ingame HUD data, etc) */
function updateScreenElements (menu) {
  // TODO: Change handling to only run this code perhaps every ~100ms (10 times per second for example, instead of non-stop)
  switch (menu){
    case "ingame":
      if(dialog.isDialogPlaying()){
        if(ui.ingameHUDMenu.is(':visible')){ui.ingameHUDMenu.hide();}
        return; // Hide ingame HUD during dialog/cutscenes
      }else if(!ui.ingameHUDMenu.is(':visible')){ ui.ingameHUDMenu.show(); }
      let curPos = player.body.position;
      // Update the ingame HUD elements
      ui.hud1ValElem.text(player.speed.toFixed(2) + ", curMoveSpeed: " + player.curMoveSpeed.toFixed(2) + ")");
      ui.hud2ValElem.text(player.onGround ? "✔️" : "✖️");
      ui.hud3ValElem.text(player.isSliding ? "✔️" : "✖️");
      ui.hud4ValElem.text(player.surfaceTiltDeg.toFixed(2));
      ui.hud5ValElem.text(game.currentFPS.toFixed(0));
      ui.hudCollectibles.text(player.collectableCount);
      ui.hudXValElem.text(curPos.x.toFixed(1)); ui.hudYValElem.text(curPos.y.toFixed(1)); ui.hudZValElem.text(curPos.z.toFixed(1));
      let maxUIVelo = 10; // Arbitrary number to cap the UI speed progress bar to
      ui.speedProgressBar.width((player.speed / maxUIVelo) * 100 + "%");
      break;
    case "settings":
      ui.settings_walkInput.val(gameSettings.defaultMoveSpeed);
      ui.settings_sprintInput.val(gameSettings.defaultSprintSpeed);
      ui.settings_jumpInput.val(gameSettings.defaultJumpHeight);
      // Constantly updates the debugLabel status to reflect the current `debugMode` state
      ui.settings_debugLabel.text(gameSettings.debugMode ? "✅" : "❌");
      // Set whether or not specified elements are enabled/disabled according to game.debugMode
      if (!gameSettings.debugMode) {
        if (!ui.settings_applyWalkBtn.attr("disabled")) {
          ui.settings_applyWalkBtn.attr("disabled", "disabled");
          ui.settings_applySprintBtn.attr("disabled", "disabled");
          ui.settings_applyJumpBtn.attr("disabled", "disabled");
        }
        if (!ui.settings_walkInput.attr("disabled")) {
          ui.settings_walkInput.attr("disabled", "disabled");
          ui.settings_sprintInput.attr("disabled", "disabled");
          ui.settings_jumpInput.attr("disabled", "disabled");
        }
      } else {
        ui.settings_applyWalkBtn.removeAttr("disabled");
        ui.settings_applySprintBtn.removeAttr("disabled");
        ui.settings_applyJumpBtn.removeAttr("disabled");
        ui.settings_walkInput.removeAttr("disabled");
        ui.settings_sprintInput.removeAttr("disabled");
        ui.settings_jumpInput.removeAttr("disabled");
      }
      break;
    default: return;
  }
}
/** @desc Shows specified menu (if value is not listed, default is `mainMenu`) */
export function showMenu(menu = "main") {
  $("#menus > *").hide();
  const activeMenu = gameSettings.menus[menu];
  if (activeMenu) activeMenu.show();
  if(menu === "pause"){utils.pauseScene();}else if(menu === "ingame"){utils.resumeScene();}
}

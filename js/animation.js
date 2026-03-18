import {player, scene, gameSettings, game, animationData} from "./globals.js";

/** @desc Used to apply specific qualities to all/some animations (mainly used to assign default animation weight & blending status) */
export function getSceneAnimations() {
  for (let animations of scene.animationGroups) game.animations.push(animations.name)
  // Loop through all animationGroups in the scene & initialize their weight, enableBlending, and blendingSpeed values
  if (game.animations.length > 0) {
    for (let i = 0; i < game.animations.length; i++) {
      let curAnim = scene.getAnimationGroupByName(game.animations[i]); if(!curAnim) continue;
      curAnim.weight = 0; curAnim.enableBlending = true;
      curAnim.blendingSpeed = gameSettings.defaultAnimBlendValue;
    }
  }
  return game.animations;
}
/** @desc Returns which player animation should be playing based on the player's data */
function getAnimationState() {
  // Handle customization menu idle animation
  if(game.curMenu === "customization"){ return animationData.idleStandClean; }
  // Handle isJumping/falling animations
  if(player.movement.isJumping && player.onGround && player.movement.isMoving){
    return animationData.jump;
  }else if(!player.onGround){
    // TODO: Implement start/end frame specifications, and start anim half way through (falling)
    return animationData.jumpHigh;
  }else if(player.movement.isJumpBtnDown && !player.movement.isMoving){
    return animationData.jumpHighIdle;
  }else if(player.swatting && !player.movement.isMoving && !player.isAfk) {
    return animationData.attack;
  }
  // Handle all onGround animations
  if(player.onGround) {
    if(player.speed > 0.01 && !player.movement.isMoving && player.curAnimation !== animationData.idleStand) {
      return animationData.walkToStand;
    }else if(player.speed < (gameSettings.defaultMoveSpeed * 0.9) && player.speed > 0.01) {
      if (gameSettings.debugMode) console.log("Player isWalking");
      return animationData.walk;
    }else if(player.speed >= (gameSettings.defaultMoveSpeed * 0.9) && player.speed < (gameSettings.defaultMoveSpeed * 1.25)){
      if(gameSettings.debugMode) console.log("Player trotting");
      return animationData.trot;
    }else if(player.speed >= (gameSettings.defaultMoveSpeed * 1.25)) {
      if (gameSettings.debugMode) console.log("Player sprinting");
      return animationData.gallop;
    }else if(player.speed <= 0.01) {
      if(player.lastMoveTime + gameSettings.defaultAfkDelay <= game.time) {
        if(!player.isAfk) { player.isAfk = true; }
        return animationData.idleSleep;
      } else { return animationData.idleStand; }
    }
  }
}
/** @desc Logic code run every frame to detect changes to the player animation state */
export function handleAnimations() {
  const newState = getAnimationState();
  if (!newState || newState === player.curAnimation) return;
  stopAllAnimations();
  playAnimation(newState);
}
/** @desc Creates looping float and spin BabylonJS animations on a collectable TransformNode, applied once at spawn */
export function animateCollectable(groupNode) {
  const fps = 60, amp = 0.1, baseY = groupNode.position.y + 0.25;
  const floatAnim = new BABYLON.Animation("collectableFloat", "position.y", fps, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
  const ease = new BABYLON.SineEase(); ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
  floatAnim.setEasingFunction(ease);
  floatAnim.setKeys([{ frame: 0, value: baseY }, { frame: 120, value: baseY + amp }, { frame: 240, value: baseY }]);
  const spinFrames = Math.round((Math.PI * 2) / (gameSettings.defaultCollectableRotSpeed * 0.01)); // Match defaultCollectableRotSpeed
  const spinAnim = new BABYLON.Animation("collectableSpin", "rotation.y", fps, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
  spinAnim.setKeys([{ frame: 0, value: 0 }, { frame: spinFrames, value: Math.PI * 2 }]);
  scene.beginDirectAnimation(groupNode, [floatAnim], 0, 240, true); // Float and spin loop independently
  scene.beginDirectAnimation(groupNode, [spinAnim], 0, spinFrames, true);
}
/** @desc Creates a looping rainbow Color3 animation on a collectable mesh's outlineColor */
export function animateCollectableColor(mesh) {
  const colorAnim = new BABYLON.Animation("collectableColor", "outlineColor", 60, BABYLON.Animation.ANIMATIONTYPE_COLOR3, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
  colorAnim.setKeys([
    { frame:   0, value: new BABYLON.Color3(1, 0, 0) }, // red
    { frame:  60, value: new BABYLON.Color3(1, 1, 0) }, // yellow
    { frame: 120, value: new BABYLON.Color3(0, 1, 0) }, // green
    { frame: 180, value: new BABYLON.Color3(0, 1, 1) }, // cyan
    { frame: 240, value: new BABYLON.Color3(0, 0, 1) }, // blue
    { frame: 300, value: new BABYLON.Color3(1, 0, 1) }, // magenta
    { frame: 360, value: new BABYLON.Color3(1, 0, 0) }, // red
  ]);
  scene.beginDirectAnimation(mesh, [colorAnim], 0, 360, true);
}
/** @desc Animation playing handler (allows looping, start, and stop time specification per animation) */
export function playAnimation(newAnim, loop = true, startFrame = 0, endFrame = undefined) {
  if(Array.isArray(newAnim) && newAnim[0] !== player.curAnimation[0]) {
    if (newAnim[1]) { // If there is a second animation in the newAnim array, handle appropriately
      // Retrieve newAnim[0] animation key from animationData object (if it exists)
      const animKey = Object.values(animationData).find(anim => anim[0] === newAnim[0]);if (!animKey) return;
      const transitionAnim = scene.getAnimationGroupByName(animKey[0]);if (!transitionAnim) return;
      const idleAnim = scene.getAnimationGroupByName(newAnim[1]);if (!idleAnim) return;

      stopAllAnimations(); // Stop all other animations

      // Play the original desired animation, then set isTransitioning to true until animation has completed.
      transitionAnim.speedRatio = 1.0;
      transitionAnim.reset();transitionAnim.play(false);transitionAnim.setWeightForAllAnimatables(1);
      if(gameSettings.debugMode)console.log("playing transition anim: ", newAnim[0]," (on completion, play: ",newAnim[1],")");
      player.isAnimTransitioning = true;
      player.lastAnimation = player.curAnimation;player.curAnimation = newAnim;

      transitionAnim.onAnimationGroupEndObservable.addOnce(() => {
        stopAllAnimations(); // Stop all other animations
        idleAnim.speedRatio = 1.0;
        idleAnim.reset();idleAnim.play(true);idleAnim.setWeightForAllAnimatables(1);
        if(gameSettings.debugMode)console.log("playing final anim: ", newAnim[1]);
        player.isAnimTransitioning = false;
      });

      return;
    }
    if (scene.getAnimationGroupByName(newAnim[0])) {
      const desiredPlayAnim = scene.getAnimationGroupByName(newAnim[0]);
      stopAllAnimations(); // Stop all other animations on the mesh before proceeding
      // Reset, start, and `weight=1` on our desiredPlayAnim
      desiredPlayAnim.speedRatio = 1.0;
      desiredPlayAnim.reset();
      desiredPlayAnim.start(loop, 1.0, startFrame, endFrame ?? desiredPlayAnim.to);
      desiredPlayAnim.setWeightForAllAnimatables(1);
      // Slow the sleeping animation transition speed down
      if(newAnim[0] === "cat_idleSleep" && desiredPlayAnim.blendingSpeed !== 0.025) desiredPlayAnim.blendingSpeed = 0.025;
      player.lastAnimation = player.curAnimation;player.curAnimation = newAnim; // Update `curAnimation` & `lastAnimation`
      if(gameSettings.debugMode)console.log("playing anim: ", newAnim[0]);
      return;
    }
  }
  return false;
}
/** @desc Stops all animations loaded in the scene via `scene.animationGroups`, ignoring animations tagged with `metadata.isNPCAnim` */
export function stopAllAnimations() {
  // TODO: This is currently only used for player animations, create separate function to stopPlayerAnimations() instead. Stopping ALL scene animations and filtering out NPCs manually doesn't make sense
  scene.animationGroups.forEach(group => {
    if(group.metadata?.isNPCAnim) return;
    group.stop();group.weight = 0;
  })
}
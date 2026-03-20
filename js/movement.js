import {game, gameSettings, player, scene} from "./globals.js";
import * as utils from "./utils.js";
import {vec, vec3} from "./utils.js";

let desiredRotation, desiredMovement = vec3(), lastJumpTime = 0, playerBodyMaterial = { friction: 0 };
/** @desc Handles the player movement and applies forces to the `player.body` based on desired direction. Determines which direction and how strong the force is based on factors like `gameSettings.maxDefaultMoveSpeed */
export function handleMovement () {
  // `player.onGround` - set by checkOnGround collision callback; `player.surfaceNormal` - set by checkOnGround from Havok contact normal
  if (!player.camera || !player.body || !player.body.position || !player.body.physicsBody || !player.body.physicsBody.getLinearVelocity()) return;
  let newVelocity = player.body.physicsBody.getLinearVelocity().clone();

  // Slope detection (moved before jumping)
  const angleDeg = utils.getVecDifInDegrees(player.surfaceNormal.normalize(), vec.up) % 180;
  player.surfaceTiltDeg = angleDeg;
  if(angleDeg <= gameSettings.defaultSlopeAngle) {
    player.movement.canSprint = true; player.isSliding = false;
    playerBodyMaterial.friction = player.impostorOptions.friction;
  }else if(angleDeg > gameSettings.defaultSlopeAngle && angleDeg <= gameSettings.defaultMaxSlopeAngle){
    player.movement.canSprint = false; player.isSliding = false;
    playerBodyMaterial.friction = player.impostorOptions.friction / 8; // Very slippery on slopes
  }else if(angleDeg > gameSettings.defaultMaxSlopeAngle && angleDeg <= 90){
    player.movement.canSprint = false; player.isSliding = true;
    playerBodyMaterial.friction = 0; // Zero friction on slopes (also helps prevent players from getting stuck)
  }

  // Speed adjustments
  if(player.movement.canSprint && player.movement.isSprinting && player.curMoveSpeed < gameSettings.defaultSprintSpeed) {
    player.curMoveSpeed += gameSettings.defaultMoveAccel;
  }else if(player.movement.isWalking && player.curMoveSpeed > gameSettings.defaultWalkSpeed) {
    player.curMoveSpeed -= gameSettings.defaultMoveAccel;
  }else{
    if(player.curMoveSpeed > gameSettings.defaultMoveSpeed) player.curMoveSpeed -= gameSettings.defaultMoveAccel;
    if(player.curMoveSpeed < gameSettings.defaultMoveSpeed) player.curMoveSpeed += gameSettings.defaultMoveAccel;
  }

  // Horizontal WASD movement
  if (player.movement.isMoving) {
    const cameraRotation = -player.camera.alpha;
    const camR = vec3(Math.sin(cameraRotation), 0, Math.cos(cameraRotation)).normalize();
    const camFw = vec3(Math.sin(cameraRotation - Math.PI / 2), 0, Math.cos(cameraRotation - Math.PI / 2)).normalize();
    if (player.movement.forward && !player.movement.back) desiredMovement.addInPlace(camFw);
    if (player.movement.right && !player.movement.left) desiredMovement.addInPlace(camR);
    if (player.movement.back && !player.movement.forward) desiredMovement.addInPlace(camFw.scale(-1)); // TODO: handle differently
    if (player.movement.left && !player.movement.right) desiredMovement.addInPlace(camR.scale(-1));
    if (desiredMovement.length() > 0) {
      player.isAfk = false; player.lastMoveTime = game.time;
      let desiredHoriz = desiredMovement.normalize().scale(player.curMoveSpeed);
      // Blend current horizontal velocity with desired input to only give player SLIGHT movement control while in air
      if (!player.onGround) desiredHoriz = BABYLON.Vector3.Lerp(vec3(newVelocity.x, 0, newVelocity.z), desiredHoriz, gameSettings.defaultAirControl);
      newVelocity.x = BABYLON.Scalar.Lerp(newVelocity.x, desiredHoriz.x, gameSettings.defaultMoveBlend);
      newVelocity.z = BABYLON.Scalar.Lerp(newVelocity.z, desiredHoriz.z, gameSettings.defaultMoveBlend);
    }
  }

  // Reset jump charge if player is moving or airborne (charge only valid while grounded and still)
  if (player.movement.isJumpBtnDown && (!player.onGround || player.movement.isMoving)) {
    player.jumpChargeStart = performance.now();
  }

  // Jump handling
  let jumped = false;
  if (player.movement.isJumping) {
    player.movement.isJumping = false; // Set isJumping back to false regardless of ability to jump
    if (player.onGround && game.time > lastJumpTime + (gameSettings.defaultJumpDelay * 1000) && player.canJump) {
      lastJumpTime = game.time; jumped = true; player.jumpCount++;
      let jumpVelocity;
      if (!player.movement.isMoving) {
        const chargeFactor = Math.min((performance.now() - player.jumpChargeStart) / player.chargeJumpDelay, 1.0);
        jumpVelocity = BABYLON.Scalar.Lerp(gameSettings.defaultMinJumpHeight, player.jumpHeight + (gameSettings.defaultSprintSpeed / 2), chargeFactor);
      } else {
        jumpVelocity = player.jumpHeight + (player.curMoveSpeed / 2);
      }
      player.lastJumpVelocity = jumpVelocity;
      newVelocity.y = player.surfaceNormal.normalize().scale(jumpVelocity).y;
    }
  }
  if(!player.onGround) playerBodyMaterial.friction = 0; // Also helps prevent player from getting stuck

  // Finalize movement data
  desiredRotation = BABYLON.Quaternion.FromEulerAngles(0, Math.atan2(-desiredMovement.x, -desiredMovement.z), 0); // Purely horizontal desiredMovement for initial desiredRotation
  const applySlopeRotation = angleDeg > 1 && angleDeg <= 45;
  if (applySlopeRotation) {
    const surfaceRotation = BABYLON.Quaternion.FromLookDirectionLH(BABYLON.Vector3.Cross(vec.left, player.surfaceNormal),player.surfaceNormal);
    desiredRotation = surfaceRotation.multiply(desiredRotation.normalize()); // If on angled surface, add slope angle to desiredRotation
  }
  player.body.physicsBody.shape.material = playerBodyMaterial; // Apply accumulated friction value once
  player.body.physicsBody.setLinearDamping(player.onGround && !player.movement.isMoving ? 5 : 0); // Only damp when grounded and not moving; zero while moving or in air
  if(player.movement.canMove) player.body.rotationQuaternion = BABYLON.Quaternion.Slerp(player.body.rotationQuaternion, desiredRotation.normalize(), gameSettings.defaultRotationSpeed);
  player.body.physicsBody.setAngularVelocity(vec3());

  // Only override velocity when we actually modified it; otherwise let Havok friction decelerate naturally
  if(player.movement.canMove && !player.isSliding && (player.movement.isMoving || jumped)) {
    player.body.physicsBody.setLinearVelocity(newVelocity);
  }
  player.speed = player.body.physicsBody.getLinearVelocity().length();
}

export function checkOnGround(event) {
  if (event.type === BABYLON.PhysicsEventType.COLLISION_FINISHED) return;
  const playerUp = BABYLON.Vector3.TransformNormal(vec3(0,1,0), BABYLON.Matrix.FromQuaternionToRef(player.body.rotationQuaternion ?? BABYLON.Quaternion.Identity(), BABYLON.Matrix.Identity()));
  if (BABYLON.Vector3.Dot(event.normal, playerUp) < -0.5) {
    player.onGround = true; // Contact normal opposes player local up = bottom of collider hit something
    player.surfaceNormal = event.normal.scale(-1); // Flip: event.normal points into player, flip to get surface-up normal
  }
}
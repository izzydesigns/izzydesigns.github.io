import {game, gameSettings, player, scene} from "./globals.js";
import * as utils from "./utils.js";
import {vec, vec3} from "./utils.js";

let desiredRotation, desiredMovement = vec3(), lastJumpTime = 0, prePhysVel = undefined, playerBodyMaterial = { friction: 0, restitution: 0 }, coyoteTimeFrames = 0;
let headQueryShape = undefined, headQueryShapeScale = undefined, jumpProtectUntil = 0;
let manualCrouch = false;

/** @desc Setter for internal `manualCrouch` variable (used in inputs.js) */
export function setManualCrouch(value) { manualCrouch = value; }
/** @desc Handles the player movement and applies forces to the `player.body` based on desired direction. Determines which direction and how strong the force is based on factors like `gameSettings.maxDefaultMoveSpeed */
export function handleMovement () {
  if (!player.camera || !player.body || !player.body.position || !player.body.physicsBody || !player.body.physicsBody.getLinearVelocity()) return;
  let newVelocity = player.body.physicsBody.getLinearVelocity().clone();

  // Slope detection (moved before jumping)
  const angleDeg = utils.getVecDifInDegrees(player.surfaceNormal.normalize(), vec.up) % 180;
  player.surfaceTiltDeg = angleDeg;
  if(angleDeg <= gameSettings.defaultSlopeAngle) {
    player.canSprint = true; player.movement.isSliding = false;
    playerBodyMaterial.friction = player.impostorOptions.friction;
  }else if(angleDeg > gameSettings.defaultSlopeAngle && angleDeg <= gameSettings.defaultMaxSlopeAngle){
    player.canSprint = false; player.movement.isSliding = false;
    playerBodyMaterial.friction = player.impostorOptions.friction / 8; // Very slippery on slopes
  }else if(angleDeg > gameSettings.defaultMaxSlopeAngle && angleDeg <= 90){
    player.canSprint = false; player.movement.isSliding = true;
    playerBodyMaterial.friction = 0; // Zero friction on slopes (also helps prevent players from getting stuck)
  }

  // Speed adjustments
  if(player.movement.isCrouching || (player.movement.isBiting && player.biteTarget)) {
    if(player.curMoveSpeed > gameSettings.defaultWalkSpeed) player.curMoveSpeed -= gameSettings.defaultMoveAccel;
    if(player.curMoveSpeed < gameSettings.defaultWalkSpeed) player.curMoveSpeed += gameSettings.defaultMoveAccel;
  }else if(player.canSprint && player.movement.isSprinting && player.curMoveSpeed < gameSettings.defaultSprintSpeed) {
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
    const camRight = vec3(Math.sin(cameraRotation), 0, Math.cos(cameraRotation)).normalize();
    const camForward = vec3(Math.sin(cameraRotation - Math.PI / 2), 0, Math.cos(cameraRotation - Math.PI / 2)).normalize();
    if (player.movement.forward && !player.movement.back) desiredMovement.addInPlace(camForward);
    if (player.movement.right && !player.movement.left) desiredMovement.addInPlace(camRight);
    if (player.movement.back && !player.movement.forward) desiredMovement.addInPlace(camForward.scale(-1));
    if (player.movement.left && !player.movement.right) desiredMovement.addInPlace(camRight.scale(-1));
    if (desiredMovement.length() > 0) {
      player.movement.isAfk = false; player.lastMoveTime = game.time;
      let desiredHorizVelo = desiredMovement.normalize().scale(player.curMoveSpeed);
      // Blend current horizontal velocity with desired input to only give player SLIGHT movement control while in air
      if (!player.onGround) desiredHorizVelo = BABYLON.Vector3.Lerp(vec3(newVelocity.x, 0, newVelocity.z), desiredHorizVelo, gameSettings.defaultAirControl);
      newVelocity.x = BABYLON.Scalar.Lerp(newVelocity.x, desiredHorizVelo.x, gameSettings.defaultMoveBlend);
      newVelocity.z = BABYLON.Scalar.Lerp(newVelocity.z, desiredHorizVelo.z, gameSettings.defaultMoveBlend);
    }
  }

  // Jump handling
  let jumped = false;
  if (player.movement.isJumping) {
    player.movement.isJumping = false; // Set isJumping back to false regardless of ability to jump
    if (player.onGround && game.time > lastJumpTime + (gameSettings.defaultJumpDelay * 1000) && player.canJump) {
      lastJumpTime = game.time; jumped = true;
      jumpProtectUntil = performance.now() + 150; // Protect jump velocity for 150ms: Havok still reports ground contact for 1 physics step after jump fires, which causes onGroundSnap to cancel the velocity
      player.onGround = false; player.canChargeJump = false; coyoteTimeFrames = 4; // Immediately exit ground state so onGroundSnap doesn't cancel the jump velocity
      const chargeFactor = Math.min((performance.now() - player.jumpChargeStart) / gameSettings.defaultJumpChargeTime, 1.0);
      const bodyScaleFactor = (1 + (player.bodyScale - 1) * 0.1);
      const base = gameSettings.defaultMinJumpHeight + (player.movement.isMoving ? player.curMoveSpeed / 10 : 0);
      let jumpVelocity = base * (chargeFactor + 1) * bodyScaleFactor;
      if(player.movement.isCrouching) jumpVelocity *= 0.8;
      if(player.movement.isBiting) jumpVelocity *= 0.5;
      newVelocity.y = player.surfaceNormal.normalize().scale(jumpVelocity).y;
      player.lastJumpVelocity = newVelocity.y; // Store vertical component only
    }
  }
  if(!player.onGround) playerBodyMaterial.friction = 0; // Also helps prevent player from getting stuck

  // When biting and moving backwards, flip rotation 180° so player faces forward regardless of left/right input
  const bitePullingBack = player.movement.isBiting && player.biteTarget && player.movement.back && !player.movement.forward;
  const horizontalAngle = Math.atan2(-desiredMovement.x, -desiredMovement.z) + (bitePullingBack ? Math.PI : 0);

  // Finalize movement data
  desiredRotation = BABYLON.Quaternion.FromEulerAngles(0, horizontalAngle, 0);
  if(angleDeg > 1 && angleDeg < 45) {
    const surfaceRotation = BABYLON.Quaternion.FromLookDirectionLH(BABYLON.Vector3.Cross(vec.left, player.surfaceNormal),player.surfaceNormal);
    desiredRotation = surfaceRotation.multiply(desiredRotation.normalize()); // If on angled surface, add slope angle to desiredRotation
  }
  player.body.physicsBody.shape.material = playerBodyMaterial; // Apply accumulated friction value once
  player.body.physicsBody.setLinearDamping(player.onGround && !player.movement.isMoving ? 5 : 0); // Only damp when grounded and not moving; zero while moving or in air
  if(player.canMove) player.body.rotationQuaternion = BABYLON.Quaternion.Slerp(player.body.rotationQuaternion, desiredRotation.normalize(), gameSettings.defaultRotationSpeed);
  player.body.physicsBody.setAngularVelocity(vec3());

  // Only override velocity when we actually modified it; otherwise let Havok friction decelerate naturally
  if(player.canMove && !player.movement.isSliding && (player.movement.isMoving || jumped)) {
    player.body.physicsBody.setLinearVelocity(newVelocity);
  }
  player.speed = player.body.physicsBody.getLinearVelocity().length();
}
/** @desc Zeroes upward vertical velocity each physics step while grounded, preventing Havok penetration correction from launching the player. Called via `onAfterPhysicsObservable` in game.js */
export function onGroundSnap() {
  if (!player.body?.physicsBody || !player.onGround) return;
  if (performance.now() < jumpProtectUntil) return; // Don't snap during jump protection window
  if (player.surfaceTiltDeg > 1) return; // On slopes, onGroundSnap would restore prePhysVel every frame, undoing gravity/friction deceleration: let physics handle it
  const vel = player.body.physicsBody.getLinearVelocity();
  if (vel.y < 0.05) return; // ignore tiny normal-force fluctuations
  player.body.physicsBody.setLinearVelocity(new BABYLON.Vector3(prePhysVel?.x ?? vel.x, 0, prePhysVel?.z ?? vel.z));
}
/** @desc Resets ground state before each physics step. Called via `onBeforePhysicsObservable` in game.js */
export function resetGroundState() {
  if (!player.body?.physicsBody) return;
  if (++coyoteTimeFrames >= 4) player.onGround = false; // Coyote time: only go airborne after 4 consecutive physics steps with no ground collision
  // surfaceNormal intentionally NOT reset: preserves last known value so slope tilt carries over when briefly airborne
  prePhysVel = player.body.physicsBody.getLinearVelocity().clone();
}
/** @desc Havok collision callback registered on `player.body`. Sets `player.onGround` and `player.surfaceNormal` when a contact normal opposes the player's local up vector, indicating the bottom of the collider has hit a surface */
export function checkOnGround(event) {
  if (event.type === BABYLON.PhysicsEventType.COLLISION_FINISHED) return;
  const playerUp = BABYLON.Vector3.TransformNormal(vec3(0,1,0), BABYLON.Matrix.FromQuaternionToRef(player.body.rotationQuaternion ?? BABYLON.Quaternion.Identity(), BABYLON.Matrix.Identity()));
  const dot = BABYLON.Vector3.Dot(event.normal, playerUp);
  if (dot < -0.5) {
    player.onGround = true;
    player.surfaceNormal = event.normal.scale(-1); // Flip: event.normal points into player, flip to get surface-up normal
    const justLanded = !player.canChargeJump; // true only when transitioning back from a jump
    coyoteTimeFrames = 0; player.canChargeJump = true;
    if (justLanded && player.movement.isJumpBtnDown) player.jumpChargeStart = performance.now(); // Reset charge timer once on landing so held space doesn't inherit stale timestamp
  }
}
/** @desc Havok collision callback registered on `player.body`. Sets `player.movement.isCrouching` when a contact normal aligns with the player's local up vector, indicating the top of the collider has hit a surface */
export function checkHeadCollision(event) {
  if (event.type === BABYLON.PhysicsEventType.COLLISION_FINISHED) return;
  const playerUp = BABYLON.Vector3.TransformNormal(vec3(0,1,0), BABYLON.Matrix.FromQuaternionToRef(player.body.rotationQuaternion ?? BABYLON.Quaternion.Identity(), BABYLON.Matrix.Identity()));
  const dot = BABYLON.Vector3.Dot(event.normal, playerUp);
  if (dot > 0.5) {
    if (!player.movement.isCrouching) {
      player.movement.isCrouching = true;
      utils.applyBodyScale(vec3(player.bodyScale, player.bodyScale * gameSettings.defaultCrouchHeight, player.bodyScale), false);
    }
  }
}
/** @desc Runs a one-shot Havok shapeProximity query in the volume between the crouched and standing player head. Returns `true` if the volume is clear (safe to stand), `false` if something is present */
export function isHeadClear() {
  if (!player.body?.physicsBody) return true;
  const havokPlugin = scene.getPhysicsEngine()?.getPhysicsPlugin();
  if (!havokPlugin?.shapeProximity) return true;
  const queryH = player.boundingBox.y * player.bodyScale * (1 - gameSettings.defaultCrouchHeight);
  const crouchedHalfH = player.boundingBox.y * player.bodyScale * gameSettings.defaultCrouchHeight / 2;
  // Position the query shape 0.1 units above the crouched collider top so maxDistance doesn't pick up the player's own body
  const queryCenterY = player.body.position.y + crouchedHalfH + 0.1 + queryH / 2;
  if (!headQueryShape || headQueryShapeScale !== player.bodyScale) {
    if (headQueryShape) headQueryShape.dispose();
    const pb = player.boundingBox, ch = gameSettings.defaultCrouchHeight;
    headQueryShape = new BABYLON.PhysicsShapeBox(BABYLON.Vector3.Zero(), BABYLON.Quaternion.Identity(),
      new BABYLON.Vector3(pb.x * player.bodyScale, pb.y * player.bodyScale * (1 - ch), pb.z * player.bodyScale), scene
    );
    headQueryShapeScale = player.bodyScale;
  }
  const localResult = new BABYLON.ProximityCastResult(), worldResult = new BABYLON.ProximityCastResult();
  havokPlugin.shapeProximity({
    shape: headQueryShape,
    position: new BABYLON.Vector3(player.body.position.x, queryCenterY, player.body.position.z),
    rotation: player.body.rotationQuaternion ?? BABYLON.Quaternion.Identity(),
    maxDistance: 0.05, shouldHitTriggers: false,
  }, localResult, worldResult);
  return !worldResult.hasHit;
}
/** @desc Per-physics-step auto-uncrouch: when the player was force-crouched (not manually), uncrouches them as soon as the standing-delta volume above their head is clear */
export function tryAutoUncrouch() {
  if (!player.movement.isCrouching || manualCrouch) return;
  if (isHeadClear()) {
    player.movement.isCrouching = false;
    utils.applyBodyScale(vec3(player.bodyScale, player.bodyScale, player.bodyScale), false);
  }
}
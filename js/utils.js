import {canvas, engine, game, gameSettings, player, scene, ui} from "./globals.js";

const DEBUG_ENABLE_SINGLE_HITS_ONLY = false; // Still deciding if physics objects should have multiple impulses applied when swatted or not
export let camTargetChanged = false; // True when camera has been moved away from the player during a dialog sequence
let desiredCameraDistance = gameSettings.defaultCamDist; // Player's intended zoom, preserved across wall hits
let meshesHitWhenPawing = []; // Tracks meshes collided with pawHitbox during swatting (to limit which meshes to apply impulses to)
let showcaseTargetNode = undefined, onScreenPrompt = undefined, currentPhysicsScaleY = undefined;
let cameraShowcaseMode = false;

// SCENE HELPERS
/** @desc Initializes the `player.camera` variable with a new ArcRotateCamera named "camera", with its radius set to `gameSettings.defaultCamDist`. Hooks into Babylon's onAfterCheckInputsObservable for raycast-based camera zoom collision, so it runs at the same time as Babylon's own camera update. */
export function initPlayerCamera() {
  player.camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 2, Math.PI / 4, gameSettings.defaultCamDist, undefined, scene);
  player.camera.attachControl(canvas, true); // Attach camera controls to the canvas
  player.camera.wheelPrecision = 15; // How much each scrollwheel scroll zooms the camera in/out
  player.camera.lowerRadiusLimit = 0.01; // How close can the camera come to player
  player.camera.upperRadiusLimit = gameSettings.defaultMaxCamDist; // How far can the camera go from the player
  player.camera.minZ = 0.01; // Distance before camera starts to hide surfaces that are too close
  player.camera.inertia = 0.1;
  player.camera.speed = 100;
  player.camera.fov = 1; // Default is 0.8 radians (~1/4th pi, somewhat small), so we increase it
  player.camera.inputs.attached.pointers.useCtrlForPanning = false; // Prevent Ctrl key from switching camera to pan mode (doesn't do anything?)
  // Raycast-based camera zoom collision (hooked directly into Babylon's camera input cycle)
  const camRay = new BABYLON.Ray();
  let prevCameraRadius = gameSettings.defaultCamDist, isFirstPerson = false;
  player.camera.onAfterCheckInputsObservable.add(() => {
    // Track scroll input in both normal and showcase mode
    if (Math.abs(player.camera.radius - prevCameraRadius) > 0.01) desiredCameraDistance = player.camera.radius;

    if (!cameraShowcaseMode) { // Disallows first/third person mode switching in "item/collectables showcase" mode TODO: why?
      if (isFirstPerson) {
        if (player.camera.radius > 0.01) { // Exiting first person mode
          player.camera.lowerRadiusLimit = 0.01;
          player.camera.inertialRadiusOffset = 0;
          toggleCamView(isFirstPerson = false);
          player.camera.radius = prevCameraRadius = desiredCameraDistance = gameSettings.defaultMinCamDist; // Resets to minimum third-person camera distance
        } else { player.camera.radius = prevCameraRadius = 0; } // In first person mode
        return;
      }
      if (desiredCameraDistance < 0.5) {
        player.camera.lowerRadiusLimit = player.camera.inertialRadiusOffset = desiredCameraDistance = prevCameraRadius = 0;
        toggleCamView(isFirstPerson = true);
        return;
      }
    }

    // Raycast-based camera collision, runs in both normal and showcase mode
    camRay.origin = player.camera.target.clone();
    camRay.direction = player.camera.position.subtract(player.camera.target).normalize();
    camRay.length = desiredCameraDistance;
    const ignoreMeshes = [player.body, player.mesh, player.pawHitbox, scene.getMeshByName("Player_geometry"), scene.getMeshByName("camOffset")];
    const hit = scene.pickWithRay(camRay, m => m.isVisible && m.visibility > 0 && !ignoreMeshes.includes(m) && !m.name.includes("_trigger") && (showcaseTargetNode == undefined || (m !== showcaseTargetNode && !m.isDescendantOf(showcaseTargetNode))));
    if (hit?.pickedPoint) {
      player.camera.radius = Math.max(BABYLON.Vector3.Distance(player.camera.target, hit.pickedPoint) - 0.2, player.camera.lowerRadiusLimit);
    } else {
      player.camera.radius = BABYLON.Scalar.Lerp(player.camera.radius, desiredCameraDistance, 0.1);
    }
    prevCameraRadius = player.camera.radius;
  });
}
let engineWasPaused = false;
/** @desc Pauses game logic. If `pauseEngine` is true, also freezes physics and animations. */
export function pauseScene(pauseEngine = false) {
  if(game.paused) return;
  game.paused = true;
  if(pauseEngine) {
    scene.physicsEnabled = false;
    scene.animationsEnabled = false;
    engineWasPaused = true;
  }
}
/** @desc Resumes game logic, and restores physics/animations if they were paused by `pauseScene`. */
export function resumeScene() {
  if(!game.paused) return;
  game.paused = false;
  if(engineWasPaused) {
    scene.physicsEnabled = true;
    scene.animationsEnabled = true;
    scene.resetLastAnimationTimeFrame();
    engineWasPaused = false;
  }
}
/** @desc Creates a skybox using BabylonJS's built-in helper. `size` defaults to 1024. */
export function createSkybox(rootUrl, size=1024) {
  if(scene.getMeshByName("hdrSkyBox")){console.error("Error: Skybox already exists");return;}
  const skybox = scene.createDefaultSkybox(new BABYLON.CubeTexture(rootUrl, scene), false, size);
  if (skybox) skybox.infiniteDistance = true;
}
/** @desc Applies the desired `renderOutline` values to the desired mesh */
export function applyOutlineTo(meshName, width) {
  let mesh = meshName;
  // Check if meshName specified is a string, if so, replace 'mesh' with named mesh
  if(typeof mesh === 'string'){ mesh = scene.getMeshByName(meshName); }
  if (!mesh) return;
  mesh.renderOutline = true;
  mesh.outlineColor = new BABYLON.Color3(0, 0, 0);
  mesh.outlineWidth = width?width:0.004; // custom width
}
/** @desc Applies outline width and color to a physics object mesh and all its outline-enabled children (handles compound physics objects). */
function setPhysicsObjectOutline(rootMesh, width, color) {
  [rootMesh, ...rootMesh.getChildMeshes()].forEach(m => {
    if (!m.renderOutline) return;
    m.outlineWidth = width; m.outlineColor = color;
  });
}
/** @desc Per-frame: highlights the nearest valid bite target with 2x outline thickness, and switches its color to white while it is actively bitten. Resets outlines when the target changes or leaves range. */
export function updateBiteHoverOutline() {
  const activeTarget = player.biteTarget ?? findNearestBiteTarget();
  if (player.hoverTarget && player.hoverTarget !== activeTarget) {
    setPhysicsObjectOutline(player.hoverTarget, gameSettings.defaultLineThickness, new BABYLON.Color3(0, 0, 0));
  }
  player.hoverTarget = activeTarget;
  if (!activeTarget) return;
  const color = player.biteTarget === activeTarget ? BABYLON.Color3.White() : new BABYLON.Color3(0.533, 0.533, 0.533);
  setPhysicsObjectOutline(activeTarget, gameSettings.defaultLineThickness * 2, color);
}

// UI HELPERS
/** @desc Briefly shows a center-screen toast message outside of dialog sequences, then fades it out */
export function showToastPrompt(html, duration=3000) {
  // Clear existing prompts (if exists)
  if (onScreenPrompt) { clearTimeout(onScreenPrompt); onScreenPrompt = undefined; }
  // Set `html` value, stop all previous CSS animations, then fadeIn
  ui.toastPrompt.html(html).stop(true, true).fadeIn(300);
  // Create `setTimeout` to later fadeOut the on-screen toast after specified `duration` milliseconds
  onScreenPrompt = setTimeout(() => {
    ui.toastPrompt.fadeOut(600, () => { onScreenPrompt = undefined; });
  }, duration);
}

// MESH HELPERS
/** @desc Shorthand for importing meshes (returns result of `BABYLON.SceneLoader.ImportMeshAsync`) */
export async function loadMesh(directory, fileName, meshName=undefined, outlineEnabled){
  const result = await BABYLON.SceneLoader.ImportMeshAsync('', directory, fileName, scene);
  if(!result) {console.error("Couldn't load mesh at directory: ",directory,fileName);return;}
  result.meshes.forEach(m => {
    if(meshName) m.name = m.id = meshName;
    const playerOutline = gameSettings.defaultLineThickness * 0.2;
    if(outlineEnabled) applyOutlineTo(m, fileName===player.curModel?playerOutline:gameSettings.defaultLineThickness);
  });
  return result;
}
/** @desc Teleports `mesh` to `pos` and keeps the velocity if `keepVelocity` is true */
export function teleportMesh(mesh, pos, keepVelocity = false) {
  mesh.position = pos;
  if (!keepVelocity && mesh.physicsBody) { // Stops ALL movement if keepVelocity is false
    mesh.physicsBody.setLinearVelocity(vec3()); // Halt all movement velocity
    mesh.physicsBody.setAngularVelocity(vec3()); // Halt all rotational velocity
  }
}
/** @desc Teleports specifically the `player.body` mesh to `pos` and keeps the velocity if `keepVelocity` is true. (NOTE: This is mostly just used as a shorthand for `teleportMesh(player.body, pos, keepVelocity);` ) */
export function teleportPlayer(pos, keepVelocity = false) {
  teleportMesh(player.body, pos, keepVelocity);
}
/** @desc Toggles between first person and third person camera views. First person targets the neck_TopSHJnt bone tracker; third person targets the camOffset node. */
function toggleCamView(firstPerson) {
  player.firstPerson = firstPerson;
  player.camera.minZ = firstPerson ? 0.3 : 0.01;
  // Save angles before setTarget - rebuildAnglesAndRadius recomputes alpha/beta from camera world pos vs new target, which changes the look direction
  const savedAlpha = player.camera.alpha, savedBeta = player.camera.beta;
  if (firstPerson) {
    if (player.neckBoneTracker) player.camera.setTarget(player.neckBoneTracker);
    player.camera.radius = 0; // Must be AFTER setTarget - setTarget recomputes radius as distance to new target, overwriting any earlier assignment
  } else {
    player.camera.setTarget(player.camOffset);
    if (player.thirdPersonCamOffset) player.camOffset.position = player.thirdPersonCamOffset.clone();
  }
  player.camera.alpha = savedAlpha; player.camera.beta = savedBeta; // Restore after setTarget so look direction is unchanged
}
/** @desc Updates player.bodyScale and re-applies scale to the mesh and physics collider at runtime. Swaps only the PhysicsShapeBox on the existing PhysicsBody so velocity, angular damping, and collision callbacks are all preserved. */
export function applyBodyScale(scaleVec, scaleMesh = true) {
  if (!player.body || !player.mesh || !player.boundingBox) return;
  player.bodyScale = scaleVec.x; // X is always the uniform base; jump formula reads from here TODO: why?
  const playerBB = player.boundingBox;
  if (scaleMesh) { player.body.scaling = scaleVec; }
  else {
    // Keep collider bottom on floor, then reposition body so the new shape's bottom matches
    const oldExtentsY = playerBB.y * (currentPhysicsScaleY ?? player.body.scaling.y);
    const newExtentsY = playerBB.y * scaleVec.y;
    const floorY = player.body.position.y - oldExtentsY / 2;
    const newCenterY = floorY + newExtentsY / 2;
    const yOffset = newCenterY - player.body.position.y;
    player.body.position.y = newCenterY;
    player.mesh.position.y -= yOffset / player.body.scaling.y; // Counteract in local space so mesh world Y stays unchanged
    if (player.camOffset) player.camOffset.position.y -= yOffset / player.body.scaling.y; // Compensate instantly so camera world Y doesn't snap; lerp handles the smooth transition
  }
  const physicsBody = player.body.physicsBody, oldShape = physicsBody.shape;
  const newExtents = new BABYLON.Vector3(playerBB.x * scaleVec.x, playerBB.y * scaleVec.y, playerBB.z * scaleVec.z);
  const opts = player.impostorOptions;
  const newShape = new BABYLON.PhysicsShapeBox(BABYLON.Vector3.Zero(), BABYLON.Quaternion.Identity(), newExtents, scene);
  newShape.material = { friction: opts.friction, restitution: opts.restitution };
  newShape.filterMembershipMask = oldShape?.filterMembershipMask ?? 0;
  physicsBody.shape = newShape;
  if (oldShape) oldShape.dispose();
  physicsBody.computeMassProperties();
  if (scaleMesh && player.pawHitbox) player.pawHitbox.scaling = vec3(scaleVec.x, scaleVec.x, scaleVec.x); // pawHitbox stays uniform
  currentPhysicsScaleY = scaleVec.y; // Always update so uncrouch knows the previous crouched Y scale
}
/** @desc Applies the specified texture to the specified result */
export function applyPlayerTexture(result, url) {
  const newTex = new BABYLON.Texture(url, scene, false, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
  const m = result.meshes.find(m => m.name === "Player_geometry");
  const mat = m.material; if (!mat) return;
  const src = mat.emissiveTexture || mat.albedoTexture || mat.diffuseTexture;
  if (src) {
    newTex.coordinatesIndex = src.coordinatesIndex ?? 0;
    newTex.uOffset = src.uOffset ?? 0; newTex.vOffset = src.vOffset ?? 0;
    newTex.uScale  = src.uScale  ?? 1; newTex.vScale  = src.vScale  ?? 1;
    newTex.wrapU = src.wrapU; newTex.wrapV = src.wrapV;
  } else { newTex.coordinatesIndex = 0; }
  mat.emissiveTexture = newTex;
  if (mat.emissiveColor) mat.emissiveColor = BABYLON.Color3.White();
  m.material.backFaceCulling = true;
}
/** @desc Pins `player.camera` target to a `string` mesh name, `string` transform node name, or `[x,y,z]` array */
export function pinCameraTo(meshOrName) {
  const restorePlayer = (meshOrName === undefined || meshOrName === 'player');
  if (restorePlayer) {
    cameraShowcaseMode = camTargetChanged = false;
    showcaseTargetNode = undefined;
    player.camera.upperRadiusLimit = gameSettings.defaultMaxCamDist;
    player.camera.setTarget(player.camOffset);
    return;
  }
  camTargetChanged = true;
  if (Array.isArray(meshOrName)) { player.camera.setTarget(new BABYLON.Vector3(meshOrName[0], meshOrName[1], meshOrName[2])); return; }
  // Non-player target: pin camera, preserve zoom
  cameraShowcaseMode = true;
  if (typeof meshOrName === 'string') {
    const target = scene.getMeshByName(meshOrName) ?? scene.getTransformNodeByName(meshOrName);
    const geomTarget = (target?.getTotalVertices?.() === 0)
      ? (target.getChildMeshes(false).find(m => m.getTotalVertices() > 0) ?? target)
      : target;
    let camPos = geomTarget?.getAbsolutePosition()?.clone() ?? undefined;
    if (camPos && geomTarget.getTotalVertices?.() > 0) {
      const bb = geomTarget.getBoundingInfo().boundingBox;
      camPos.y = (bb.maximumWorld.y + bb.minimumWorld.y) / 2;
    }
    showcaseTargetNode = target ?? undefined;
    player.camera.setTarget(camPos ?? geomTarget ?? player.camOffset);
  } else {
    showcaseTargetNode = meshOrName;
    player.camera.setTarget(meshOrName);
  }
  player.camera.radius = desiredCameraDistance; // Preserve player's current desired zoom
}
/** @desc Handles player swatting mechanic, including paw bone tracking & application of force impulses based on player.swatStrength */
export function handleSwatting() {
  const boneTracker = scene.getNodeByName("pawBoneTracker");
  const pawHitbox = scene.getMeshByName("pawHitbox");
  if(!boneTracker || !pawHitbox) return;
  boneTracker.computeWorldMatrix(true); // Force world matrix update (reflects bone state before physics step)
  pawHitbox.setAbsolutePosition(boneTracker.getAbsolutePosition());
  if(!player.swatting) { // Reset object hit list when player stops swatting (if single hits only), and return early
    if(DEBUG_ENABLE_SINGLE_HITS_ONLY) { meshesHitWhenPawing = [] } return;
  }
  const hitBodies = new Set(); // Children share root physicsBody (only apply impulse once per body, per step)
  scene.meshes.forEach(mesh => {
    // Child meshes of compound bodies have no physicsBody (intentional, resolve on parent physics mesh)
    const physBody = mesh.physicsBody ?? mesh.parent?.physicsBody;
    const physMesh = mesh.physicsBody ? mesh : mesh.parent;
    if(!physBody || physMesh === player.body || hitBodies.has(physBody)) return;
    if(pawHitbox.intersectsMesh(mesh, false)){
      if(DEBUG_ENABLE_SINGLE_HITS_ONLY) meshesHitWhenPawing.push(mesh.name); // Register hit before applying impulse to ensure it only fires once per mesh per swat
      hitBodies.add(physBody);
      const impulseDir = physMesh.getAbsolutePosition().subtract(player.body.position).normalize();
      const swatImpulseMultiplier = player.movement.isSprinting ? 1.5 : player.movement.isWalking ? 0.5 : 1.0;
      physBody.applyImpulse(impulseDir.scale(player.swatStrength * swatImpulseMultiplier), physMesh.getAbsolutePosition());
    }
  });
}
/** @desc Handles player biting mechanic, including head bone tracking & spring-damper-based impulse system */
export function handleBiting() {
  // Sync mouth anchor to neck bone position with a slight forward offset each physics step
  if (player.neckBoneTracker && player.mouthAnchor) {
    player.neckBoneTracker.computeWorldMatrix(true);
    const forward = player.body.getDirection(new BABYLON.Vector3(0, 0, -1)); // Cat model faces local -Z, so -Z is the true forward direction
    const mouthForwardOffset = (player.boundingBox.z * player.bodyScale) / 4; // ~0.28 at default scale; scales with body size
    player.mouthAnchor.setAbsolutePosition(player.neckBoneTracker.getAbsolutePosition().add(forward.scale(mouthForwardOffset)));
    if (!player.mouthAnchor.rotationQuaternion) player.mouthAnchor.rotationQuaternion = BABYLON.Quaternion.Identity();
    else player.mouthAnchor.rotationQuaternion.copyFromFloats(0, 0, 0, 1);
  }
  // Spring-damper bite: pull the grab point toward the mouth anchor each step instead of using a hard constraint
  if (player.biteTarget && player.biteGrabPivotB) {
    const grabWorld = BABYLON.Vector3.TransformCoordinates(player.biteGrabPivotB, player.biteTarget.getWorldMatrix());
    const anchorWorld = player.mouthAnchor.getAbsolutePosition();
    const delta = anchorWorld.subtract(grabWorld);
    const stretch = delta.length();
    const biteMass = player.biteTarget.physicsBody.getMassProperties().mass ?? 1;
    const breakDistanceMultiplier = 1 + (Math.min(biteMass, 50) - 1) / 49; // Scales from 1x at 1kg to 2x at 50kg
    if (stretch > gameSettings.defaultBiteBreakDistance * breakDistanceMultiplier) { releaseBite(); }
    else {
      const targetVel = player.biteTarget.physicsBody.getLinearVelocity();
      const springForce = delta.scale(gameSettings.defaultBiteSpringStrength);
      const dampingForce = targetVel.scale(-gameSettings.defaultBiteDamping);
      player.biteTarget.physicsBody.applyForce(springForce.add(dampingForce), grabWorld);
    }
  }
}
/** @desc Finds and returns the nearest biteable physics object within `gameSettings.defaultBiteRadius` of the mouth anchor, without latching. Returns null if none found. */
export function findNearestBiteTarget() {
  if (!player.mouthAnchor?.physicsBody) return null;
  const mouthPos = player.mouthAnchor.getAbsolutePosition();
  let nearestMesh = null, nearestDist = gameSettings.defaultBiteRadius;
  scene.meshes.forEach(mesh => {
    if (!mesh.physicsBody || mesh === player.body || mesh === player.mouthAnchor || !mesh.name.includes("_physics") || mesh.name.includes("_trigger")) return;
    const dist = BABYLON.Vector3.Distance(mouthPos, mesh.getAbsolutePosition());
    if (dist < nearestDist) { nearestMesh = mesh; nearestDist = dist; return; }
    // For large objects: if mouthAnchor is inside the world bounding box, treat as the closest candidate
    const bb = mesh.getBoundingInfo().boundingBox;
    if (mouthPos.x >= bb.minimumWorld.x && mouthPos.x <= bb.maximumWorld.x
      && mouthPos.y >= bb.minimumWorld.y && mouthPos.y <= bb.maximumWorld.y
      && mouthPos.z >= bb.minimumWorld.z && mouthPos.z <= bb.maximumWorld.z) {
      nearestMesh = mesh; nearestDist = 0;
    }
  });
  return nearestMesh;
}
/** @desc Finds the nearest biteable physics object within `gameSettings.defaultBiteRadius` of the mouth anchor and attaches it via a ball-and-socket constraint. Grab pivot on the target is offset to its closest surface point toward the mouth to prevent center-clipping. */
export function startBite() {
  if (!player.mouthAnchor?.physicsBody || player.biteTarget) return;
  const nearestMesh = findNearestBiteTarget();
  if (!nearestMesh) return;
  // Grab point: surface of target closest to the mouth anchor; if mouthAnchor is inside the bounding sphere, grab at mouth position directly to prevent instant break
  const mouthPos = player.mouthAnchor.getAbsolutePosition();
  const meshCenter = nearestMesh.getAbsolutePosition();
  const dirToMouth = mouthPos.subtract(meshCenter).normalize();
  const grabRadius = nearestMesh.getBoundingInfo().boundingSphere.radiusWorld;
  const distToCenter = BABYLON.Vector3.Distance(mouthPos, meshCenter);
  const grabPointWorld = distToCenter < grabRadius ? mouthPos.clone() : meshCenter.add(dirToMouth.scale(grabRadius));
  const pivotOnTarget = BABYLON.Vector3.TransformCoordinates(grabPointWorld, BABYLON.Matrix.Invert(nearestMesh.getWorldMatrix()));
  player.biteTarget = nearestMesh;
  player.biteGrabPivotB = pivotOnTarget;
}
/** @desc Releases the current bite and resets all biting state. */
export function releaseBite() {
  player.biteTarget = undefined;
  player.biteGrabPivotB = undefined;
  player.movement.isBiting = false;
}

// MATH HELPERS
/** @desc Vector shorthands (aka use `vec.up` for `BABYLON.Vector3.Up()`, `vec.down` for `BABYLON.Vector3.Down()`, and also added left right forward and backward vectors). */
export const vec = {
  up: vec3(0,1,0), down: vec3(0,-1,0),
  right: vec3(1,0,0), left: vec3(-1,0,0),
  forward: vec3(0,0,1), backward: vec3(0,0,-1),
};
/** @desc Shorthand for `new BABYLON.Vector3(x,y,z)`, use `vec3(x,y,z)` instead for brevity. Default values are `0,0,0`, so `vec3()` is equivalent to `BABYLON.Vector3.Zero()` */
export function vec3(x=0,y=0,z=0){return new BABYLON.Vector3(x,y,z);}
/** @desc Returns a 360 degree value in relation to the angular difference between two vector directions */
export function getVecDifInDegrees(vec1, vec2){ return BABYLON.Tools.ToDegrees(Math.acos(BABYLON.Vector3.Dot(vec1.normalize(), vec2.normalize()))) }
/** @desc Converts a `BABYLON.Quaternion` to Euler angles, returning a `BABYLON.Vector3` */
export function quatToEuler(quat){return quat.toEulerAngles();}
/** @desc Converts a `BABYLON.Vector3` of Euler angles to a `BABYLON.Quaternion` */
export function eulerToQuat(vector){return new BABYLON.Quaternion(vector.x,vector.y,vector.z,0);}

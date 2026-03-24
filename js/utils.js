import {canvas, engine, game, gameSettings, player, scene} from "./globals.js";
import * as level from "./level.js";
import * as movement from "./movement.js";

let currentPhysicsScaleY = null; // Tracks the Y scale of the current physics shape independently of player.body.scaling.y (which doesn't change during crouch)

/** @desc Vector shorthands (aka use `vec.up` for `BABYLON.Vector3.Up()`, `vec.down` for `BABYLON.Vector3.Down()`, and also added left right forward and backward vectors). */
export const vec = {
  up: vec3(0,1,0),      down: vec3(0,-1,0),
  right: vec3(1,0,0),   left: vec3(-1,0,0),
  forward: vec3(0,0,1), backward: vec3(0,0,-1),
};
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
  player.camera.inputs.attached.pointers.useCtrlForPanning = false; // Prevent Ctrl key from switching camera to pan mode (allows ControlLeft as a keybind)
  // Raycast-based camera zoom collision (hooked directly into Babylon's camera input cycle)
  const camRay = new BABYLON.Ray();
  let desiredCameraDistance = gameSettings.defaultCamDist; // player's intended zoom, preserved across wall hits
  let prevCameraRadius = gameSettings.defaultCamDist, isFirstPerson = false;
  player.camera.onAfterCheckInputsObservable.add(() => {
    if (isFirstPerson) {
      if (player.camera.radius > 0.01) {
        const minThirdPersonDist = 0.5;
        isFirstPerson = false;
        player.camera.lowerRadiusLimit = 0.01;
        player.camera.inertialRadiusOffset = 0; // Clear inertia so it doesn't accidentally exit first person
        desiredCameraDistance = minThirdPersonDist;
        toggleCamView(false);
        player.camera.radius = prevCameraRadius = minThirdPersonDist; // set camera.radius and prevCameraRadius to min third person cam distance
      } else {
        player.camera.radius = 0; // Pin at zero - lowerRadiusLimit is 0 in FP so Babylon won't clamp this back up
        prevCameraRadius = 0;
      }
      return; // Stop here, so we don't run collisions or desiredCameraDistance updates while in first person
    }
    if (Math.abs(player.camera.radius - prevCameraRadius) > 0.01) desiredCameraDistance = player.camera.radius;
    if (desiredCameraDistance < 0.5) {
      isFirstPerson = true;
      player.camera.lowerRadiusLimit = 0; // Must be 0 so Babylon doesn't clamp radius back to 0.01 every frame
      player.camera.inertialRadiusOffset = 0; // Clear any residual scroll inertia - even small positive inertia would push radius above 0.01 and immediately exit FP next frame
      desiredCameraDistance = 0;
      toggleCamView(true);
      prevCameraRadius = 0;
      return;
    }

    // Raycast-based camera collision (third person only)
    camRay.origin = player.camera.target.clone();
    camRay.direction = player.camera.position.subtract(player.camera.target).normalize();
    camRay.length = desiredCameraDistance;
    // Only test visible level geometry, invisible colliders are filtered by isVisible, player mesh excluded explicitly
    const ignoreMeshes = [player.body, player.mesh, scene.getMeshByName("Player_geometry"), scene.getMeshByName("camOffset")];
    const hit = scene.pickWithRay(camRay, m => m.isVisible && m.visibility > 0 && !ignoreMeshes.includes(m) && !m.name.includes("_trigger"));
    if (hit?.pickedPoint) {
      player.camera.radius = Math.max(BABYLON.Vector3.Distance(player.camera.target, hit.pickedPoint) - 0.05, player.camera.lowerRadiusLimit);
    } else {
      player.camera.radius = BABYLON.Scalar.Lerp(player.camera.radius, desiredCameraDistance, 0.1);
    }
    prevCameraRadius = player.camera.radius;
  });
}
/** @desc Pauses the game using `engine.stopRenderLoop()`, and sets `scene.animationsEnabled` to `false` to pause animations. */
export function pauseScene() {
  if(game.paused) return;
  game.paused = true;
  //scene.onBeforeRenderObservable.remove(renderLoop);
  engine.stopRenderLoop(); // Pause game's render loop
  console.log("Scene pausing...");
}
/** @desc Resumes the game using `engine.runRenderLoop(() => scene.render());`, and sets `scene.animationsEnabled` to `true` to resume animations. */
export function resumeScene() {
  if(!game.paused) return;
  game.paused = false;
  //scene.onBeforeRenderObservable.add(renderLoop);
  engine.runRenderLoop(() => scene.render()); // Resume rendering
  console.log("Scene resumed...");
}
/** @desc Creates a skybox using BabylonJS's built-in helper. `size` defaults to 1024. */
export function createSkybox(rootUrl, size=1024) {
  if(scene.getMeshByName("hdrSkyBox")){console.error("Error: Skybox already exists");return;}
  scene.createDefaultSkybox(new BABYLON.CubeTexture(rootUrl, scene), false, size);
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
/** @desc Creates a new mesh collision event action specifically for trigger meshes (aka meshes the player is meant to be able to move through. Returns the newly created `ActionManager` object. Handles both "OnIntersectionEnterTrigger" and "OnIntersectionExitTrigger" events, specified by the `onEnterOrExit` parameter (uses "onEnter" by default)
 * @returns BABYLON.ActionManager */
export function meshCollisionCallback(collisionMesh, onEnterOrExit, detectMesh, callback) {
  collisionMesh.collisionsEnabled = false; // Disable collisions since we're detecting onEnter and onExit events for it
  const onExit = (onEnterOrExit==="exit"||onEnterOrExit==="onExit"); // Specify `onExit` conditions so everything else defaults to `onEnter`
  let newAction = new BABYLON.ExecuteCodeAction({
    trigger: onExit?13:12, // `ActionManager.OnIntersectionEnterTrigger` & `ExitTrigger` = 12 & 13 respectively
    parameter: {mesh: detectMesh,usePreciseIntersection: true}
  },callback);
  collisionMesh.actionManager = new BABYLON.ActionManager(scene);
  collisionMesh.actionManager.registerAction(newAction);
  return collisionMesh.actionManager; // Return the actionManager object
}
/** @desc Handles the setup and initialization of the player model's mesh */
export function handlePlayerModel(result) {
  result.meshes[0].name = result.meshes[0].id = "playerMesh"; // Set player.mesh mesh name and id
  player.model = result; player.mesh = result.meshes[0]; // Initialize player.mesh with loaded mesh
  player.mesh.scaling = vec3(2, 2, 2); // Normalization factor only - player.body.scaling handles the actual bodyScale
  player.mesh.skeleton = result.skeletons[0]; // Init & store skeleton object
  player.mesh.skeleton.enableBlending(1); // Enable & set animation blending speed


  applyPlayerTexture(result, game.playerSkins.default);

  // Create simple box collider for player model collision handling TODO: eventually adjust height for dif animations (aka crouching, isJumping, etc)
  const options = player.impostorOptions;
  player.body = BABYLON.MeshBuilder.CreateBox("playerBody", { width: player.boundingBox.x, height: player.boundingBox.y, depth: player.boundingBox.z }, scene);
  player.body.scaling = vec3(player.bodyScale, player.bodyScale, player.bodyScale); // Must be set BEFORE PhysicsAggregate so it reads the correct world bounding box
  new BABYLON.PhysicsAggregate(player.body, BABYLON.PhysicsShapeType.BOX, {mass:options.mass,friction:options.friction,restitution:options.restitution}, scene);

  // Set player body data
  player.body.physicsBody.disablePreStep = false; // Allow mesh transform to sync into Havok each prestep (enables direct position/rotation control)
  player.body.physicsBody.setAngularDamping(0);
  player.body.physicsBody.setCollisionCallbackEnabled(true);
  player.body.physicsBody.getCollisionObservable().add(movement.checkOnGround); // Enable checkOnGround check within physicsBody collision events
  player.body.isVisible = gameSettings.debugMode; // Initialize player.body visibility based on initial `debugMode` status
  player.body.position = gameSettings.defaultSpawnPoint; // Teleports mesh to defaultSpawnPoint if the level being loaded does not specify a spawn point
  player.mesh.position = vec3(0, -(player.boundingBox.y / 2), 0);
  player.mesh.parent = player.body;

  // Camera offset: 85% of collider height above the mesh root, keeping the target near the cat's back at any scale
  const thirdPersonCamOffset = vec3(0, player.mesh.position.y + player.boundingBox.y * 0.85, 0);
  player.thirdPersonCamOffset = thirdPersonCamOffset.clone();
  const offsetMesh = BABYLON.MeshBuilder.CreateBox("camOffset",{size:0.01},scene);
  offsetMesh.isVisible = false; offsetMesh.parent = player.body; offsetMesh.position = thirdPersonCamOffset;
  player.camera.setTarget(offsetMesh);
  player.camOffset = offsetMesh;
  // Bone positions are relative to the actual skinned child mesh, not the __root__ TransformNode
  const skinnedMesh = player.mesh.getChildMeshes().find(m => m.skeleton) ?? player.mesh;
  const neckBone = player.mesh.skeleton.bones.find(b => b.name === "neck_TopSHJnt"); // Camera targets this neck bone when in first-person, stays parented at any bodyScale & animation state
  if (neckBone) {
    const neckTracker = new BABYLON.TransformNode("neckBoneTracker", scene);
    neckTracker.attachToBone(neckBone, skinnedMesh);
    player.neckBoneTracker = neckTracker;
  }

  // Mouth anchor: small kinematic physics body used as the attachment point for bite constraints.
  // Positioned each physics step to track the neck bone with a slight forward offset (like camOffset/pawHitbox).
  const mouthAnchorMesh = BABYLON.MeshBuilder.CreateBox("mouthAnchor", { size: 0.01 }, scene);
  mouthAnchorMesh.isVisible = false; mouthAnchorMesh.isPickable = false;
  const mouthShape = new BABYLON.PhysicsShapeBox(BABYLON.Vector3.Zero(), BABYLON.Quaternion.Identity(), vec3(0.01, 0.01, 0.01), scene);
  mouthShape.filterCollideMask = 0; // Mouth anchor must not physically collide with anything; it is a constraint anchor only
  const mouthPhysicsBody = new BABYLON.PhysicsBody(mouthAnchorMesh, BABYLON.PhysicsMotionType.ANIMATED, false, scene);
  mouthPhysicsBody.shape = mouthShape;
  mouthPhysicsBody.setMassProperties({ mass: 0 });
  mouthPhysicsBody.disablePreStep = false; // Sync kinematic body to mesh position each physics prestep
  player.mouthAnchor = mouthAnchorMesh;

  const pawBone = player.mesh.skeleton.bones.find(b => b.name === "rt_leg_ToeSHJnt");
  const boneTracker = new BABYLON.TransformNode("boneTracker", scene); // Invisible tracker parented to bone lets BabylonJS resolve bone world position internally
  boneTracker.attachToBone(pawBone, skinnedMesh); // Must pass skinnedMesh (not player.mesh) or scale/transform is applied incorrectly
  const pawHitbox = BABYLON.MeshBuilder.CreateBox("pawHitbox", {size:0.04}, scene); // Base size at bodyScale=1; multiply by bodyScale for world size
  pawHitbox.isVisible = false; pawHitbox.isPickable = false;
  pawHitbox.scaling = vec3(player.bodyScale, player.bodyScale, player.bodyScale);
  player.pawHitbox = pawHitbox; // Stored so applyBodyScale can resize this alongside bodyScale
  //let swatHits = []; // Tracks meshes already hit to prevent applying impulse multiple times per swat (NOT ACTUALLY DESIRED BEHAVIOR! commented out for now, incase I want to make this a toggle later)
  scene.onBeforePhysicsObservable.add(() => {
    // Sync mouth anchor to neck bone position with a slight forward offset each physics step
    if (player.neckBoneTracker && player.mouthAnchor) {
      player.neckBoneTracker.computeWorldMatrix(true);
      const forward = player.body.getDirection(new BABYLON.Vector3(0, 0, -1)); // Cat model faces local -Z, so -Z is the true forward direction
      const mouthForwardOffset = (player.boundingBox.z * player.bodyScale) / 4; // ~0.28 at default scale; scales with body size
      player.mouthAnchor.setAbsolutePosition(player.neckBoneTracker.getAbsolutePosition().add(forward.scale(mouthForwardOffset)));
    }
    // Spring-damper bite: pull the grab point toward the mouth anchor each step instead of using a hard constraint
    if (player.biteTarget && player.biteGrabPivotB) {
      const grabWorld = BABYLON.Vector3.TransformCoordinates(player.biteGrabPivotB, player.biteTarget.getWorldMatrix());
      const anchorWorld = player.mouthAnchor.getAbsolutePosition();
      const delta = anchorWorld.subtract(grabWorld);
      const stretch = delta.length();
      if (stretch > gameSettings.defaultBiteBreakDistance) { releaseBite(); }
      else {
        const targetVel = player.biteTarget.physicsBody.getLinearVelocity();
        const springForce = delta.scale(gameSettings.defaultBiteSpringStrength);
        const dampingForce = targetVel.scale(-gameSettings.defaultBiteDamping);
        player.biteTarget.physicsBody.applyForce(springForce.add(dampingForce), grabWorld);
      }
    }
    boneTracker.computeWorldMatrix(true); // Force world matrix update so position reflects current bone state before physics step
    pawHitbox.setAbsolutePosition(boneTracker.getAbsolutePosition());
    if(!player.swatting) /*swatHits = [];*/ return; // Reset hit list each time swat ends so next swat starts fresh
    scene.meshes.forEach(mesh => {
      if(!mesh.physicsBody || mesh === player.body) return; // Skip non-physics, player body, and already-hit meshes
      if(pawHitbox.intersectsMesh(mesh, false)){
        //swatHits.push(mesh.name); // Register hit before applying impulse to ensure it only fires once per mesh per swat
        const impulseDir = mesh.getAbsolutePosition().subtract(player.body.position).normalize();
        const swatImpulseMultiplier = player.movement.isSprinting ? 2.0 : player.movement.isWalking ? 0.5 : 1.0;
        mesh.physicsBody.applyImpulse(impulseDir.scale(player.swatStrength * swatImpulseMultiplier), mesh.getAbsolutePosition());
        console.log("Swat connected!", mesh.name);
      }
    });
  });

}
/** @desc Registers a per-frame watcher on `targetMesh` that tracks which `_physics_collider` objects are currently intersecting it, updating `player.physicsObjectsTouching` and logging entries/exits (USE SPARINGLY) */
export function watchCollider(targetMesh) {
  scene.onBeforeRenderObservable.add(() => {
    const nowTouching = scene.meshes.filter(m => (m.name.includes("_physics_collider") || m.name.includes("_physics_sphCollider") || m.name.includes("_physics_cylCollider")) && targetMesh.intersectsMesh(m, false));
    nowTouching.forEach(mesh => {
      if(level.physicsObjectsTouching.includes(mesh)) return;
      level.physicsObjectsTouching.push(mesh);
      console.log("Physics object entered:", mesh.name);
    });
    for(let i = level.physicsObjectsTouching.length - 1; i >= 0; i--){
      if(nowTouching.includes(level.physicsObjectsTouching[i])) continue;
      console.log("Physics object left:", level.physicsObjectsTouching[i].name);
      level.physicsObjectsTouching.splice(i, 1);
    }
  });
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
  player.bodyScale = scaleVec.x; // X is always the uniform base; jump formula reads from here
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
  }
  const physicsBody = player.body.physicsBody, oldShape = physicsBody.shape;
  const newExtents = new BABYLON.Vector3(playerBB.x * scaleVec.x, playerBB.y * scaleVec.y, playerBB.z * scaleVec.z);
  const opts = player.impostorOptions;
  const newShape = new BABYLON.PhysicsShapeBox(BABYLON.Vector3.Zero(), BABYLON.Quaternion.Identity(), newExtents, scene);
  newShape.material = { friction: opts.friction, restitution: opts.restitution };
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
/** @desc Copies the position, scale, and rotation values of the first mesh `fromMesh`, onto the second mesh `toMesh`. NOTE: Not meant to replace `mesh.parent`ing and meant for initializations only. */
export function copyPosScaleRotFromTo(fromMesh, toMesh){
  const worldMtx = fromMesh.getWorldMatrix();
  // Applies the relative world axis matrix to the scale/rotation/position
  return worldMtx.decompose(toMesh.scale, toMesh.rotationQuaternion, toMesh.position);
}
/** @desc Pins `player.camera` target to a `string` mesh name, `string` transform node name, or `[x,y,z]` array */
export function pinCameraTo(meshOrName) {
  if (meshOrName == null) { player.camera.setTarget(player.camOffset); return; } // Unknown arg? default to player.camOffset
  if (Array.isArray(meshOrName)) { player.camera.setTarget(new BABYLON.Vector3(meshOrName[0], meshOrName[1], meshOrName[2])); return; }
  if (typeof meshOrName === 'string') {
    if (meshOrName === 'player') { player.camera.setTarget(player.camOffset); return; }
    const target = scene.getMeshByName(meshOrName) ?? scene.getTransformNodeByName(meshOrName);
    player.camera.setTarget(target ?? player.camOffset); // Attempt to find mesh/transform node, otherwise set to player.camOffset
  } else { player.camera.setTarget(meshOrName); } // Attempt to set target directly to mesh object, if not a string or vec3 array
}
/** @desc Finds and returns the nearest biteable physics object within `gameSettings.defaultBiteRadius` of the mouth anchor, without latching. Returns null if none found. */
export function findNearestBiteTarget() {
  if (!player.mouthAnchor?.physicsBody) return null;
  const mouthPos = player.mouthAnchor.getAbsolutePosition();
  let nearestMesh = null, nearestDist = gameSettings.defaultBiteRadius;
  scene.meshes.forEach(mesh => {
    if (!mesh.physicsBody || mesh === player.body || mesh === player.mouthAnchor || mesh.name.includes("_trigger")) return;
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
/** @desc Applies outline width and color to a physics object mesh and all its outline-enabled children (handles compound objects). */
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
  player.biteTarget = null;
  player.biteGrabPivotB = null;
  player.isBiting = false;
}
/** @desc Enables object occlusion culling (to hide meshes that are not currently visible on screen) */
export function enableOcclusionOn(mesh){
  mesh.isOccluded = false;
  mesh.occlusionType = BABYLON.AbstractMesh.OCCLUSION_TYPE_OPTIMISTIC;
  mesh.occlusionQueryAlgorithmType = BABYLON.AbstractMesh.OCCLUSION_ALGORITHM_TYPE_ACCURATE;
}


// MATH HELPERS
/** @desc Shorthand for `new BABYLON.Vector3(x,y,z)`, use `vec3(x,y,z)` instead for brevity. Default values are `0,0,0`, so `vec3()` is equivalent to `BABYLON.Vector3.Zero()` */
export function vec3(x=0,y=0,z=0){return new BABYLON.Vector3(x,y,z);}
/** @desc Returns a 360 degree value in relation to the angular difference between two vector directions */
export function getVecDifInDegrees(vec1, vec2){ return BABYLON.Tools.ToDegrees(Math.acos(BABYLON.Vector3.Dot(vec1.normalize(), vec2.normalize()))) }
/** @desc Converts a `BABYLON.Quaternion` to Euler angles, returning a `BABYLON.Vector3` */
export function quatToEuler(quat){return quat.toEulerAngles();}
/** @desc Converts a `BABYLON.Vector3` of Euler angles to a `BABYLON.Quaternion` */
export function eulerToQuat(vector){return new BABYLON.Quaternion(vector.x,vector.y,vector.z,0);}

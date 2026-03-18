import {canvas, engine, game, gameSettings, player, scene} from "./globals.js";
import * as level from "./level.js";

/** @desc Vector shorthands (aka use `vec.up` for `BABYLON.Vector3.Up()`, `vec.down` for `BABYLON.Vector3.Down()`, and also added left right forward and backward vectors). */
export const vec = {
  up: vec3(0,1,0),      down: vec3(0,-1,0),
  right: vec3(1,0,0),   left: vec3(-1,0,0),
  forward: vec3(0,0,1), backward: vec3(0,0,-1),
};
let camRay = new BABYLON.Ray();
export let camCollideIgnore = [];
let desiredCameraDistance = null; // player's intended zoom level, preserved across wall collisions
let prevCameraRadius = null; // camera.radius set last frame, used to detect BabylonJS scroll changes

// SCENE HELPERS
/** @desc Initializes the `player.camera` variable with a new ArcRotateCamera named "camera", with its radius set to `gameSettings.defaultCamDist`. Collisions on the camera are also currently enabled (however changing the `camera.ellipsoid` doesn't seem to work) */
export function initPlayerCamera() {
  player.camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 2, Math.PI / 4, gameSettings.defaultCamDist, undefined, scene);
  player.camera.attachControl(canvas, true); // Attach camera controls to the canvas
  player.camera.wheelPrecision = 15; // How much each scrollwheel scroll zooms the camera in/out
  player.camera.lowerRadiusLimit = 0.01; // How close can the camera come to player
  desiredCameraDistance = gameSettings.defaultCamDist; // Init desired distance to match starting radius
  prevCameraRadius = gameSettings.defaultCamDist;
  player.camera.upperRadiusLimit = gameSettings.defaultMaxCamDist; // How far can the camera go from the player
  player.camera.minZ = 0.01; // Distance before camera starts to hide surfaces that are too close
  player.camera.inertia = 0.1;
  player.camera.speed = 100;
  player.camera.fov = 1; // Default is 0.8 radians (~1/4th pi, somewhat small), so we increase it
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
  mesh.outlineWidth = width?width:0.002; // custom width
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
  player.mesh.scaling = vec3(player.bodyScale * 2, player.bodyScale * 2, player.bodyScale * 2); // Scales player model up x2 (originally tiny)
  player.mesh.skeleton = result.skeletons[0]; // Init & store skeleton object
  player.mesh.skeleton.enableBlending(1); // Enable & set animation blending speed


  applyPlayerTexture(result, game.playerSkins.default);

  // Create simple box collider for player model collision handling TODO: eventually adjust height for dif animations (aka crouching, isJumping, etc)
  let playerBB = player.boundingBox.scaleInPlace(player.bodyScale), options = player.impostorOptions;
  player.body = BABYLON.MeshBuilder.CreateBox("playerBody",{ width: playerBB.x, height: playerBB.y, depth: playerBB.z },scene);
  new BABYLON.PhysicsAggregate(player.body, BABYLON.PhysicsShapeType.BOX, {mass:options.mass,friction:options.friction,restitution:options.restitution}, scene);

  // Set player body data
  player.body.physicsBody.disablePreStep = false; // Allow mesh transform to sync into Havok each prestep (enables direct position/rotation control)
  player.body.physicsBody.setAngularDamping(0);
  player.body.physicsBody.setCollisionCallbackEnabled(true);
  player.body.physicsBody.getCollisionObservable().add((event) => {
    if (event.type === BABYLON.PhysicsEventType.COLLISION_FINISHED) return;
    const playerUp = BABYLON.Vector3.TransformNormal(vec3(0,1,0), BABYLON.Matrix.FromQuaternionToRef(player.body.rotationQuaternion ?? BABYLON.Quaternion.Identity(), BABYLON.Matrix.Identity()));
    if (BABYLON.Vector3.Dot(event.normal, playerUp) < -0.5) player.onGround = true; // Contact normal opposes player local up = bottom of collider hit something
  });
  player.body.isVisible = gameSettings.debugMode; // Initialize player.body visibility based on initial `debugMode` status
  player.body.position = gameSettings.defaultSpawnPoint; // Teleports mesh to defaultSpawnPoint if the level being loaded does not specify a spawn point
  player.mesh.position.addInPlace(vec3(0,-0.49, 0));
  player.mesh.parent = player.body;

  // Create a dummy cube to parent the camera to, which is then parented to the player mesh
  const cameraOffset = player.mesh.position.clone().addInPlace(gameSettings.defaultCamOffset);
  const offsetMesh = BABYLON.MeshBuilder.CreateBox("camOffset",{size:0.01},scene);
  offsetMesh.isVisible = false; offsetMesh.parent = player.body; offsetMesh.position = cameraOffset;
  player.camera.setTarget(offsetMesh); // Sets target to offsetMesh (parented to player.mesh)
  player.camOffset = offsetMesh;

  const pawBone = player.mesh.skeleton.bones.find(b => b.name === "rt_leg_ToeSHJnt");
  const skinnedMesh = player.mesh.getChildMeshes().find(m => m.skeleton) ?? player.mesh; // Bone positions are relative to the actual skinned child mesh, not the __root__ node
  const boneTracker = new BABYLON.TransformNode("boneTracker", scene); // Invisible tracker parented to bone lets BabylonJS resolve bone world position internally
  boneTracker.attachToBone(pawBone, skinnedMesh); // Must pass skinnedMesh (not player.mesh) or scale/transform is applied incorrectly
  const pawHitbox = BABYLON.MeshBuilder.CreateBox("pawHitbox", {size:0.1}, scene);
  pawHitbox.isVisible = false; pawHitbox.isPickable = false;
  //let swatHits = []; // Tracks meshes already hit to prevent applying impulse multiple times per swat (NOT ACTUALLY DESIRED BEHAVIOR! commented out)
  scene.onBeforePhysicsObservable.add(() => {
    boneTracker.computeWorldMatrix(true); // Force world matrix update so position reflects current bone state before physics step
    pawHitbox.setAbsolutePosition(boneTracker.getAbsolutePosition());
    if(!player.swatting) /*swatHits = [];*/ return; // Reset hit list each time swat ends so next swat starts fresh
    scene.meshes.forEach(mesh => {
      if(!mesh.physicsBody || mesh === player.body) return; // Skip non-physics, player body, and already-hit meshes
      if(pawHitbox.intersectsMesh(mesh, false)){
        //swatHits.push(mesh.name); // Register hit before applying impulse to ensure it only fires once per mesh per swat
        const impulseDir = mesh.getAbsolutePosition().subtract(player.body.position).normalize();
        mesh.physicsBody.applyImpulse(impulseDir.scale(player.swatStrength), mesh.getAbsolutePosition()); // scale(5) caps max impulse magnitude regardless of animation speed
        console.log("Swat connected!", mesh.name);
      }
    });
  });

  camCollideIgnore.push(
    scene.getMeshByName(player.mesh.getChildren()[0].getChildren()[2].name), // `player.mesh` mesh name (named `playerMesh`)
    scene.getMeshByName(player.body.name), // `player.body.name` (named `playerBody`)
    offsetMesh, // camOffset mesh
    pawHitbox,
  );
}
export function checkCameraCollision() {
  if (!player.camera) return;
  const scrollDelta = player.camera.radius - prevCameraRadius; // detects BabylonJS scroll changes each frame
  if (player.firstPerson) { // Handle first person mode (if user scrolls/zooms all the way in)
    if (scrollDelta > 0.01) { // if user scrolls out, exit first person
      toggleCamView(player.firstPerson = false);
      desiredCameraDistance = player.camera.radius;
    }
    prevCameraRadius = player.camera.radius;
    return;
  }
  const colBuffer = 0.1, dir = player.camera.position.clone().subtract(player.camera.target).normalize();
  if (scrollDelta > 0.01) { // scrolling out, only accept if no wall blocks the new radius
    camRay.direction = dir; camRay.origin = player.camera.target; camRay.length = player.camera.radius;
    const outHit = scene.pickWithRay(camRay, m => !camCollideIgnore.includes(m), false);
    if (!outHit || !outHit.pickedPoint) {
      desiredCameraDistance = player.camera.radius; // path clear, accept new distance
      prevCameraRadius = player.camera.radius;
      return;
    }
  } else if (scrollDelta < -0.01) { // scrolled in, enter first person if already at minimum
    if (desiredCameraDistance <= gameSettings.defaultMinCamDist + colBuffer) {
      toggleCamView(player.firstPerson = true);
      prevCameraRadius = player.camera.radius;
      return;
    }
    desiredCameraDistance = player.camera.radius;
  }
  // check for wall at desired distance, clamp immediately on hit or lerp back out when clear
  camRay.direction = dir; camRay.origin = player.camera.target; camRay.length = desiredCameraDistance + colBuffer;
  const hit = scene.pickWithRay(camRay, m => !camCollideIgnore.includes(m), false);
  if (hit && hit.pickedPoint) {
    player.camera.radius = Math.max(BABYLON.Vector3.Distance(player.camera.target, hit.pickedPoint) - colBuffer, 0.01);
  } else {
    player.camera.radius = BABYLON.Scalar.Lerp(player.camera.radius, desiredCameraDistance, 0.01);
  }
  prevCameraRadius = player.camera.radius;
}
/** @desc Registers a per-frame watcher on `targetMesh` that tracks which `_physics_collider` objects are currently intersecting it, updating `player.physicsObjectsTouching` and logging entries/exits */
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
function toggleCamView(firstPerson){
  if(firstPerson) player.camera.radius = 0;
  player.camera.minZ = firstPerson?0.3:0.01; // Adjust camera clipping distance in first person mode
  player.camOffset.position = player.mesh.position.clone().addInPlace(firstPerson?new BABYLON.Vector3(0, 0.75, -0.525):gameSettings.defaultCamOffset);
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
export function quatToEuler(quat){return quat.toEulerAngles();}
export function eulerToQuat(vector){return new BABYLON.Quaternion(vector.x,vector.y,vector.z,0);}

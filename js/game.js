import {player, scene, engine, canvas, gameSettings, game} from "./globals.js";
import * as utils from "./utils.js";
import * as screen from "./screen.js";
import * as animation from "./animation.js";
import * as globals from "./globals.js";
import * as movement from "./movement.js";
import * as npc from "./npc.js";
import * as inputs from "./inputs.js";

let deltaTime;

/** @desc Initializes the game's `engine` and `scene` variables. Dynamically imports and initializes the HavokPhysics WASM plugin, then enables physics using `gameSettings.defaultGravity` */
export async function createNewScene() {
  const gpuAdapter = await navigator.gpu?.requestAdapter();
  let tempEngine, webGPUSupported = !!gpuAdapter; // Check if a real WebGPU adapter is available, not just the API
  if(webGPUSupported) {
    tempEngine = new BABYLON.WebGPUEngine(canvas, gameSettings.engineSettings);
  }else{ // Use WebGL as a fallback if WebGPU is not supported or enabled on user hardware
    console.error("Error initializing BabylonJS WebGPUEngine (using WebGL 2.0 fallback)");
    tempEngine = new BABYLON.Engine(canvas, true, gameSettings.engineSettings);
  }
  globals.setEngine(tempEngine); // Initialize & assign `engine` variable
  if(webGPUSupported) await engine.initAsync(); // Initialize WebGPU context & dependencies (if using WebGPU)
  globals.setScene(new BABYLON.Scene(engine)); // Initialize & assign `scene` variable
  const loadingScreen = $('#loadingScreen');
  engine.loadingScreen = {
    displayLoadingUI: () => loadingScreen.show(),
    hideLoadingUI: () => loadingScreen.hide(),
  };
  engine.displayLoadingUI();
  engine.renderEvenInBackground = false; // Disables scene rendering when window is in the background/minimized
  engine.deltaTime = 16; // Milliseconds per engine calculation (16.666ms = 60 calculations per second aka 60fps)
  const { default: HavokPhysics } = await import("./lib/HavokPhysics_es.js");
  const havokPlugin = new BABYLON.HavokPlugin(true, await HavokPhysics());
  scene.enablePhysics(gameSettings.defaultGravity, havokPlugin); // Using Havok physics
  // Do other scene setup stuff
  utils.initPlayerCamera(); // `player.camera` object initialization (must occur BEFORE loading/handling player mesh)
  scene.createDefaultLight(); // temporary scene lighting
  scene.getOutlineRenderer().zOffset = 0.25; // Fix outline clipping at steep view angles
  utils.createSkybox("res/skybox/Sky_LosAngeles"); // Create a skybox
  await utils.loadMesh("", player.curModel, "", true).then((result) => {
    utils.applyPlayerTexture(result, game.playerSkins.default); // Apply the default player texture (overrides mesh texture)
    result.meshes[0].name = result.meshes[0].id = "playerMesh"; // Set player.mesh mesh name & id
    player.model = result; player.mesh = result.meshes[0]; // Initialize player.mesh with loaded mesh
    player.mesh.scaling = utils.vec3(2, 2, 2); // Normalize mesh scale to match scene object scale - player.body.scaling handles the actual bodyScale
    player.mesh.skeleton = result.skeletons[0]; // Init & store skeleton object
    player.mesh.skeleton.enableBlending(1); // Enable & set animation blending speed

    // Create simple box collider for player model collision handling TODO: eventually adjust height for dif animations (aka crouching, isJumping, etc)
    const options = player.impostorOptions;
    player.body = BABYLON.MeshBuilder.CreateBox("playerBody", { width: player.boundingBox.x, height: player.boundingBox.y, depth: player.boundingBox.z }, scene);
    player.body.scaling = utils.vec3(player.bodyScale, player.bodyScale, player.bodyScale); // Must be set BEFORE PhysicsAggregate so it reads the correct world bounding box
    new BABYLON.PhysicsAggregate(player.body, BABYLON.PhysicsShapeType.BOX, {mass:options.mass,friction:options.friction,restitution:options.restitution}, scene);

    // Set player body data
    player.body.rotationQuaternion = BABYLON.Quaternion.Identity(); // Explicitly initialize so Slerp never operates on null
    player.body.physicsBody.disablePreStep = false; // Allow mesh transform to sync into Havok each prestep (enables direct position/rotation control)
    player.body.physicsBody.setAngularDamping(0);
    player.body.physicsBody.setCollisionCallbackEnabled(true);
    player.body.physicsBody.getCollisionObservable().add(movement.checkOnGround); // Enable checkOnGround check within physicsBody collision events
    player.body.physicsBody.getCollisionObservable().add(movement.checkHeadCollision); // Enable checkHeadCollision check to force-crouch on head collisions
    player.body.isVisible = gameSettings.debugMode; // Initialize player.body visibility based on initial debugMode status
    player.body.position = gameSettings.defaultSpawnPoint; // Teleports mesh to defaultSpawnPoint if the level being loaded does not specify a spawn point
    player.mesh.position = utils.vec3(0, -(player.boundingBox.y / 2), 0);
    player.mesh.parent = player.body;

    // Camera offset (85% of collider height, as specified in gameSettings.defaultCamOffset.y)
    const thirdPersonCamOffset = utils.vec3(
      gameSettings.defaultCamOffset.x,
      player.mesh.position.y + (player.boundingBox.y * gameSettings.defaultCamOffset.y),
      gameSettings.defaultCamOffset.z
    );
    player.thirdPersonCamOffset = thirdPersonCamOffset.clone();
    const offsetMesh = BABYLON.MeshBuilder.CreateBox("camOffset", {size:0.01}, scene);
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
    // Mouth anchor: attachment point for bite constraints
    const mouthAnchorMesh = BABYLON.MeshBuilder.CreateBox("mouthAnchor", { size: 0.01 }, scene);
    mouthAnchorMesh.isVisible = false; mouthAnchorMesh.isPickable = false;
    const mouthShape = new BABYLON.PhysicsShapeBox(BABYLON.Vector3.Zero(), BABYLON.Quaternion.Identity(), utils.vec3(0.01, 0.01, 0.01), scene);
    mouthShape.isTrigger = true; // Mouth anchor shouldn't collide with anything
    const mouthPhysicsBody = new BABYLON.PhysicsBody(mouthAnchorMesh, BABYLON.PhysicsMotionType.ANIMATED, false, scene);
    mouthPhysicsBody.shape = mouthShape;
    mouthPhysicsBody.setCollisionCallbackEnabled(false);
    mouthPhysicsBody.setMassProperties({ mass: 0 });
    mouthPhysicsBody.disablePreStep = false; // Sync kinematic body to mesh position each physics prestep
    mouthAnchorMesh.parent = player.body;
    player.mouthAnchor = mouthAnchorMesh;

    const pawBone = player.mesh.skeleton.bones.find(b => b.name === "rt_leg_ToeSHJnt");
    const boneTracker = new BABYLON.TransformNode("pawBoneTracker", scene); // Invisible tracker parented to bone lets BabylonJS resolve bone world position internally
    boneTracker.attachToBone(pawBone, skinnedMesh); // Must pass skinnedMesh (not player.mesh) or scale/transform is applied incorrectly
    const pawHitbox = BABYLON.MeshBuilder.CreateBox("pawHitbox", {size:0.04}, scene); // Base size at bodyScale=1; multiply by bodyScale for world size
    pawHitbox.isVisible = false; pawHitbox.isPickable = false;
    pawHitbox.scaling = utils.vec3(player.bodyScale, player.bodyScale, player.bodyScale);
    pawHitbox.parent = player.body;
    player.pawHitbox = pawHitbox; // Stored so applyBodyScale can resize this alongside bodyScale
  });
  animation.getSceneAnimations(); animation.handleAnimations();
  inputs.initInputHandlers(); // Register scene input observables (must be called after setScene)
  // Wait for scene to be fully ready before starting render loop and registering observers
  scene.executeWhenReady(() => {
    engine.hideLoadingUI();
    engine.stopRenderLoop(); // Guard: prevent double-registration if resumeScene ran before scene finished loading
    engine.runRenderLoop(() => scene.render());
    scene.onBeforeRenderObservable.add(renderLoop);
    scene.onBeforePhysicsObservable.add(movement.resetGroundState);
    scene.onBeforePhysicsObservable.add(movement.tryAutoUncrouch);
    scene.onAfterPhysicsObservable.add(movement.onGroundSnap);
    scene.onBeforePhysicsObservable.add(utils.handleBiting);
    scene.onBeforePhysicsObservable.add(utils.handleSwatting);
  });
}
/** @desc Render loop, run every single scene frame render (~240 times per sec) */
export function renderLoop() {
  if(game.paused) return;
  if(player.cursorLocked)game.time = performance.now();
  game.currentFPS = engine.getFps(); // Update game.time and game.currentFPS
  deltaTime = performance.now() - game.lastFrameTime;
  // This is the game's GAME loop. Called 60 times/sec (used whenever possible, instead of outside this if statement)
  if (deltaTime > game.frameRateLimit) {
    game.lastFrameTime = game.time - (deltaTime % game.frameRateLimit);
    gameLoop();
  }
  animation.handleAnimations(); // Handles detection of animation state & plays appropriate animations
}
/** @desc Game loop, runs every 60 fps */
function gameLoop() {
  if(player.body) movement.handleMovement(); // Handle player movement & rotation
  if(player.camOffset && player.thirdPersonCamOffset) player.camOffset.position.y = BABYLON.Scalar.Lerp(player.camOffset.position.y, player.thirdPersonCamOffset.y, 0.12); // Smooth camera height transition on crouch/uncrouch
  utils.updateBiteHoverOutline(); // Highlight the nearest biteable object; white when actively bitten
  screen.updateMenus(); // Updates on-screen elements (such as in-game HUD elements & settings menu options)
  npc.handleNPCInteractions(); // Check player proximity & look direction against spawned NPCs
}

// After initializing event window handlers, initialize on-screen elements as well
screen.initScreenElements();

await createNewScene(); // Initialize the canvas, scene, engine, and player objects
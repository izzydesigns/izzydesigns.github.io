import {player, scene, gameSettings} from "./globals.js";
import {
  copyPosScaleRotFromTo,
  loadMesh,
  meshCollisionCallback,
  teleportPlayer
} from "./utils.js";
import * as utils from "./utils.js";
import * as npc from "./npc.js";
import * as animation from "./animation.js";

const assetDir = './res/models/';
const assetList = {
  debug: ["defaultCube_1x1.glb"],
  items: [
    "unused/break_glasscup.glb",
    "unused/col_cattoy1.glb",
    "unused/col_cattoy2.glb",
    "unused/decor_carpet.glb",
    "unused/decor_catbed.glb",
    "unused/decor_curtains.glb",
    "unused/decor_flowers.glb",
    "unused/decor_couch.glb",
    "unused/decor_slippers.glb",
    "unused/interact_remote.glb",
    "unused/interact_trashcan.glb",
    "unused/physics_yarn_ball.glb",
  ],
  characters: [
    "player_cat.glb",
    "npc.glb",
  ],
  levels: [
    "levels/level1.glb",
    "levels/test.glb",
    "levels/Mainmenu_level.glb",//old first level test
    "levels/first_level.glb",
  ],
};
export let collectables = [], physicsObjectsTouching = [], totalCollectibles = 0, cameras = [];

/** @desc Handles the setup and initialization of a given level mesh. Parses various mesh data and custom level colliders, as well as any lights or animations found */
export function handleLevelModel(result) {
  player.respawnPoint = utils.vec3(); // Set default player respawnPoint to 0,0,0
  let collisionParent = new BABYLON.TransformNode("level colliders", scene); // Creates parent object for all colliders
  let triggerParent = new BABYLON.TransformNode("level triggers", scene); // Creates parent object for all triggers
  let collectablesParent = new BABYLON.TransformNode("level collectables", scene); // Creates parent object for all collectables
  let physicsParent = new BABYLON.TransformNode("level physics objects", scene); // Creates parent object for all physics objects
  const physicsGroups = new Map(); // Keyed by base name; each entry is an array of _primitive submeshes sharing one physics hull
  for(let curGeo of result.meshes){
    const geoName = curGeo.name;
    if(geoName.toLowerCase() === "__root__"){ curGeo.name = "level mesh"; }
    if(!geoName.includes("_collider") && !geoName.includes("_sphCollider") && !geoName.includes("_cylCollider") && !geoName.includes("_trigger") && !geoName.includes("_physics") && !geoName.includes("_collectable")) continue;
      if(geoName.includes("_collectable")){
        let collectableName = geoName.replace(/_primitive\d+|_collectable/g, "");
        let groupNode = scene.getNodeByName("collectable_" + collectableName) || undefined;
        if (!groupNode) { // Create parent "collectable" transform node if one doesn't already exist for this mesh
          groupNode = new BABYLON.TransformNode("collectable_" + collectableName, scene);
          copyPosScaleRotFromTo(curGeo, groupNode);
          animation.animateCollectable(groupNode); // Apply looping float + spin once at spawn
          totalCollectibles++;
        }
        curGeo.outlineColor = new BABYLON.Color3(1,1,1); // set initial color before rainbow animation takes over
        curGeo.outlineWidth = gameSettings.defaultLineThickness * 2;
        animation.animateCollectableColor(curGeo); // rainbow outline cycle
        curGeo.parent = groupNode; // Set subgeometry parent to groupNode transform node
        groupNode.parent = collectablesParent; // Set collectable groupNode parent to collectablesParent main node
        curGeo.metadata = { parentNode: groupNode }; // apparently transform nodes don't count as parents or something... but this fixes that
        createCollectibleItem(curGeo);
      } else {
        let colliderMesh;
        let meshScale = utils.vec3(), meshRot = new BABYLON.Quaternion();
        curGeo.getWorldMatrix().decompose(meshScale, meshRot, null);
        const localBB = curGeo.getBoundingInfo().boundingBox;
        const bbWidth = (localBB.maximum.x - localBB.minimum.x) * meshScale.x;
        const bbHeight = (localBB.maximum.y - localBB.minimum.y) * meshScale.y;
        const bbDepth = (localBB.maximum.z - localBB.minimum.z) * meshScale.z;
        const physicsOptions = {mass: 0, friction: 0.9, restitution: 0};
        if(geoName.includes("_trigger")){
          colliderMesh = BABYLON.MeshBuilder.CreateBox(geoName,{width:bbWidth,height:bbHeight,depth:bbDepth},scene);
          meshCollisionCallback(colliderMesh,"onEnter",player.mesh,()=>{});
          colliderMesh.parent = triggerParent; colliderMesh.visibility = 0; curGeo.dispose();
        }else if (geoName.includes("_physics")) {
          const baseName = geoName.replace(/_primitive\d+$/, "");
          if (!physicsGroups.has(baseName)) physicsGroups.set(baseName, []);
          physicsGroups.get(baseName).push(curGeo); // Deferred and handled below
        } else if (geoName.includes("_collider") || geoName.includes("_sphCollider") || geoName.includes("_cylCollider")) {
          if (geoName.includes("_collider")) {
            colliderMesh = BABYLON.MeshBuilder.CreateBox(geoName, { width: bbWidth, height: bbHeight, depth: bbDepth }, scene);
            colliderMesh.position = localBB.centerWorld.clone();
            colliderMesh.rotationQuaternion = meshRot;
            new BABYLON.PhysicsAggregate(colliderMesh, BABYLON.PhysicsShapeType.BOX, physicsOptions, scene);
          }else if(geoName.includes("_sphCollider")){
            const radius = Math.max(bbWidth, bbHeight, bbDepth) / 2;
            colliderMesh = BABYLON.MeshBuilder.CreateSphere(geoName, {diameter: radius * 2}, scene);
            colliderMesh.position = localBB.centerWorld.clone();
            colliderMesh.rotationQuaternion = meshRot;
            new BABYLON.PhysicsAggregate(colliderMesh, BABYLON.PhysicsShapeType.SPHERE, physicsOptions, scene);
          }else if(geoName.includes("_cylCollider")){
            const radius = Math.max(bbWidth, bbDepth) / 2;
            colliderMesh = BABYLON.MeshBuilder.CreateCylinder(geoName, {height: bbHeight, diameter: radius * 2}, scene);
            colliderMesh.position = localBB.centerWorld.clone();
            colliderMesh.rotationQuaternion = meshRot;
            new BABYLON.PhysicsAggregate(colliderMesh, BABYLON.PhysicsShapeType.CYLINDER, physicsOptions, scene);
          }
          colliderMesh.parent = collisionParent;
          colliderMesh.visibility = 0;
          curGeo.dispose();
        } else { console.log("Unknown geometry: geoName = " + geoName); }
      }
  }
  const hashGroups = new Map(); // groupId → { rootBody, container }
  const massScalingVal = 10; // Value to multiply the physicsBody bounding box volume amount by, for dynamically calculating total object mass

  // Pre-compute total mass for each compound group by summing OOBB volumes of all submeshes
  const groupMasses = new Map();
  for (const [baseName, meshes] of physicsGroups) {
    const hashIdx = baseName.indexOf('#');
    if (hashIdx === -1) continue;
    const groupId = baseName.slice(hashIdx + 1);
    for (const m of meshes) {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      const vol = (bb.maximumWorld.x - bb.minimumWorld.x) * (bb.maximumWorld.y - bb.minimumWorld.y) * (bb.maximumWorld.z - bb.minimumWorld.z);
      groupMasses.set(groupId, (groupMasses.get(groupId) ?? 0) + vol * massScalingVal);
    }
  }
  for (const [gId, mass] of groupMasses) { groupMasses.set(gId, Math.min(50, Math.max(0.1, mass))); }

  for (const [baseName, meshes] of physicsGroups) {
    meshes.forEach(m => { m.setParent(null); m.computeWorldMatrix(true); });
    let physicsBody;
    if (meshes.length === 1) {
      physicsBody = meshes[0];
    } else {
      const srcMtx = meshes[0].getWorldMatrix().clone(); // all primitives in a group share the same world transform (same Blender origin)
      const srcPos = new BABYLON.Vector3(), srcRot = new BABYLON.Quaternion(), srcScale = new BABYLON.Vector3();
      srcMtx.decompose(srcScale, srcRot, srcPos);
      const merged = BABYLON.Mesh.MergeMeshes(meshes, false, true, undefined, true, true); // multiMultiMaterials preserves all source materials so merged serves as both visual and physics body
      if (!merged) { console.warn(`[Physics] MergeMeshes failed for "${baseName}", skipping`); continue; }
      merged.bakeTransformIntoVertices(srcMtx.clone().invert()); // convert world-space verts back to source local space, then restore source transform so Havok gets correct rotation/scale
      merged.refreshBoundingInfo(); // recompute AABB after baking so frustum culling uses correct local bounds
      merged.position = srcPos; merged.rotationQuaternion = srcRot; merged.scaling = srcScale;
      merged.computeWorldMatrix(true);
      merged.name = baseName + "_physicsBody";
      meshes.forEach(m => m.dispose()); // sources baked into merged, dispose to avoid duplicate geometry and stale-BB flicker from setParent
      physicsBody = merged;
    }
    utils.applyOutlineTo(physicsBody, gameSettings.defaultLineThickness);

    const hashIdx = baseName.indexOf('#');
    if (hashIdx !== -1) {
      const groupId = baseName.slice(hashIdx + 1);
      let groupNode = scene.getTransformNodeByName(groupId);
      if (!groupNode) { groupNode = new BABYLON.TransformNode(groupId, scene); groupNode.parent = physicsParent; }
      if (!hashGroups.has(groupId)) {
        // First mesh with this tag becomes the root compound body
        const container = new BABYLON.PhysicsShapeContainer(scene);
        const body = new BABYLON.PhysicsBody(physicsBody, BABYLON.PhysicsMotionType.DYNAMIC, false, scene);
        container.addChildFromParent(physicsBody, new BABYLON.PhysicsShapeConvexHull(physicsBody, scene), physicsBody);
        body.shape = container;
        body.setMassProperties({ mass: groupMasses.get(groupId) });
        body.disablePreStep = false;
        hashGroups.set(groupId, { rootBody: physicsBody, container });
        physicsBody.parent = groupNode;
      } else {
        // Subsequent mesh, add its hull to the root's container, parent visually to root
        const { rootBody, container } = hashGroups.get(groupId);
        container.addChildFromParent(rootBody, new BABYLON.PhysicsShapeConvexHull(physicsBody, scene), physicsBody);
        physicsBody.setParent(rootBody); // preserves world position
      }
    } else {
      const bb = physicsBody.getBoundingInfo().boundingBox;
      const mass = Math.min(50, Math.max(0.1, // Lock mass value between 50 and 0.1
        (bb.maximumWorld.x - bb.minimumWorld.x) * (bb.maximumWorld.y - bb.minimumWorld.y) * (bb.maximumWorld.z - bb.minimumWorld.z) * massScalingVal
      ));
      new BABYLON.PhysicsAggregate(physicsBody, BABYLON.PhysicsShapeType.CONVEX_HULL, {mass, friction: 0.9}, scene);
      physicsBody.parent = physicsParent;
    }
    // DEBUG: show convex hull source geometry as semi-transparent overlay so you can see what Havok builds its hull from
    if (gameSettings.debugMode) { physicsBody.isVisible = true; physicsBody.visibility = 0.35; physicsBody.material = null; }
  }
  for(let data of result.transformNodes){
    // Load & parse other misc level mesh data (spawn points, lighting info, NPC node graphs, whatever else!)
    switch(data.name){
      case "Customize":
        teleportPlayer(data.absolutePosition);
        break;
      case "Spawn":
        player.respawnPoint = data.absolutePosition;
        break;
      default:
        // Any transform node named "Name_NPC" spawns a static NPC named "Name" at that node's world position
        if(data.name.endsWith("_NPC")){
          const npcName = data.name.slice(0, -4); // Strip "_NPC" suffix to get the NPC's actual name
          npc.spawnNPC(npcName, data.absolutePosition.clone()); // async fire-and-forget
        }else if(data.name.endsWith("_cam")){
          cameras.push(data);
          console.log(data.name, data);
        }
        break;
    }
  }
  for(let light of result.lights){
    // Load scene lights (and fix intensity)
    //light.intensity *= 0.0025; // Fix for intensity scaling issue, adjust as necessary
  }
  //utils.watchCollider(scene.getMeshByName("CatBed_Torus_collider")); // TODO: seemingly not working anymore? double check later on
}

/** @desc Shorthand for `await loadMesh()` and chooses `whichLevel` from `level.assetList.levels[]` */
export async function loadLevel(whichLevel) { await loadMesh(assetDir, assetList.levels[whichLevel-1], undefined, true).then(handleLevelModel); }

/** @desc Registers a collision callback on `itemMesh` so that when `player.body` intersects it, the collectable's parent `TransformNode` is disposed and `player.collectableCount` is incremented */
function createCollectibleItem(itemMesh) {
  collectables.push(itemMesh); // push collectable mesh to array so `animation.js` can animate the items
  // The callback receives no parameters; we rely on `itemMesh` from the closure
  meshCollisionCallback(itemMesh, "onEnter", player.body, () => {
    const groupNode = itemMesh.metadata.parentNode; // Gets parent transformNode to access all other collectable submeshes
    if (groupNode) {
      //groupNode.getChildren().forEach(child=>child.dispose()); // Dispose of all submeshes
      groupNode.dispose(); // Finally, dispose the empty TransformNode
      player.collectableCount++;
      console.log("Collectible obtained! "+player.collectableCount+"/"+totalCollectibles);
    }
  });
}
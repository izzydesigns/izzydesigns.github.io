import {animationData, gameSettings, player, scene, ui} from "./globals.js";
import {loadMesh} from "./utils.js";

export const NPC_ANIM_TAG = { isNPCAnim: true }; // Metadata key applied to NPC animation groups so `stopAllAnimations()` in `animation.js` can skip them
export let currentlyLookingAtNPC = null; // Tracks which NPC the player is currently looking at. Exported so `game.js` can read it for the interact key handler.
export let npcs = []; // Array of all spawned NPC data objects: { name, root, meshes, animGroups }
const npcSpeakingDist = 3; // Max world-unit distance before "looking at NPC" detection activates

/** @desc Spawns an NPC at the given world `position` by loading the player model and playing the idle stand animation on loop (Called from `handleLevelModel` when a `_NPC` transform node is detected) */
export async function spawnNPC(npcName, position) {
  const result = await loadMesh("", player.curModel, "", true); // Load NPC model (no outline)
  if (!result) { console.error("spawnNPC: Failed to load model for NPC "+npcName); return; }
  const rootMesh = result.meshes[0];
  rootMesh.name = rootMesh.id = "npc_"+npcName;
  rootMesh.position = position.clone();
  rootMesh.scaling = player.mesh.scaling.clone(); // Match player model scale (for now)
  // TODO: set NPC rotation value as well (and set to rotate to face player when within "speaking" range, default rotation otherwise)

  // Find and start the idle stand animation on loop, tagged so stopAllAnimations() skips it
  const idleAnimName = animationData.idleStand[0]; // "cat_idleStandA"
  const idleAnim = result.animationGroups.find(ag => ag.name === idleAnimName);
  if (idleAnim) {
    idleAnim.metadata = NPC_ANIM_TAG; // Tag so animation.js stopAllAnimations() leaves it alone
    idleAnim.start(true); // true = loop indefinitely
  } else { console.warn("spawnNPC: Animation "+idleAnimName+" not found for NPC "+npcName); }

  // Tag ALL remaining animation groups for this NPC so they get skipped by animation.stopAllAnimations()
  result.animationGroups.forEach(ag => { if (!ag.metadata) ag.metadata = NPC_ANIM_TAG; });
  const npcData = {
    meshes: result.meshes, // NPC meshes (npcData.meshes[0] = root mesh
    name: npcName, // Name of NPC (assigned & fetched by level mesh node itself)
    animGroups: result.animationGroups // All animations associated with specified NPC mesh
  };
  npcs.push(npcData);
  if(gameSettings.debugMode) console.log("NPC "+npcName+" spawned at "+position.x.toFixed(2)+"x, "+position.y.toFixed(2)+"y, "+position.z.toFixed(2)+"z");
  return npcData;
}

/** @desc Run each game loop frame. For every NPC within speaking distance, checks if the camera crosshair ray hits them. */
export function handleNPCInteractions() {
  if (!player.body || !player.camera || npcs.length === 0) return;
  const screenW = scene.getEngine().getRenderWidth(), screenH = scene.getEngine().getRenderHeight();
  let nowLookingAt = null;
  for (const npc of npcs) {
    if(!npc.root) continue;
    const dist = BABYLON.Vector3.Distance(player.body.getAbsolutePosition(), npc.root.getAbsolutePosition());
    if (dist > npcSpeakingDist) continue; // Too far away, skip
    // Player is within speaking distance, cast ray from screen center to check direct line-of-sight to NPC
    const pickResult = scene.pick(screenW / 2, screenH / 2, mesh => npc.meshes.includes(mesh));
    if (pickResult && pickResult.hit) { nowLookingAt = npc; break; } // No need to check other NPCs
  }
  // Only update UI/log when the looked-at NPC actually changes, not every frame
  if (nowLookingAt !== currentlyLookingAtNPC) {
    currentlyLookingAtNPC = nowLookingAt;
    if (nowLookingAt) {
      ui.npcPromptName.text(nowLookingAt.name); ui.npcPrompt.show();
      if(gameSettings.debugMode) console.log("[NPC] Looking at: "+nowLookingAt.name);
      ui.npcPrompt.removeClass("hidden");
      console.log(`[NPC] Looking at: "${nowLookingAt.name}"`);
    } else {
      ui.npcPrompt.addClass("hidden");
    }
  }
}

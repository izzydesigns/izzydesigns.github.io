// Code for handling audio events goes here (see https://doc.babylonjs.com/features/featuresDeepDive/audio/playingSoundsMusic#creating-a-spatial-3d-sound)
async function initAudioEngine() {
  const audioEngine = await BABYLON.CreateAudioEngineAsync();
  await audioEngine.unlockAsync();
  // Other audio engine initialization stuff here
}

const soundTypes = ["music","npcline","sound","effect"];

async function playSound(type, name, soundDir, volume, location){
  const vol = volume * 1.0; // replace 1.0 with (gameSettings.masterVolume * gameSettings.
  // play sound file (located at soundDir) at desired volume
  // if sound was played already and currently paused, resume instead of starting over from beginning
  switch(type){
    case "music":
      console.log("playing "+name+" music track");
      break;
    case "sound":
      console.log("playing 3d spacial sound "+name+" at: ", location);
      break;
    case "effect":
      console.log("playing "+name+" sound effect");
      break;
  }
  return true;
}

function pauseSound(name){
  // pause sound
}

function stopSound(name){
  // stop sound
}

function stopAllSounds(type){
  // stops ALL sounds
}

/*

For continuously looping background music we use a streaming sound:
BABYLON.CreateStreamingSoundAsync("name", "<sound file URL>", { loop: true, autoplay: true }, audioEngine);

To play a short sound once we can use a sound that plays from a fully downloaded buffer:
const sound = await BABYLON.CreateSoundAsync("sound", "<sound file URL>");
sound.play();

*/
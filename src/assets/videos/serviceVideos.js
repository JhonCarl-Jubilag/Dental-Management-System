import toothFillingVideo from './tooth-filling-animation.mp4';
import toothExtractionVideo from './tooth-extraction-animation.mp4';
import oralProphylaxisVideo from './oral-prophylaxis-animation.mp4';
import fixedBridgesVideo from './fixed-bridges-animation.mp4';
import pedodonticsVideo from './pedodontics-treatment-animation.mp4';
import inlayVideo from './inlay-animation.mp4';
import onlayVideo from './onlay-animation.mp4';
import emaxVeneersVideo from './emax-veneers-animation.mp4';
import orthodonticsVideo from './orthodontics-animation.mp4';
import mucosalFlapVideo from './mucosal-flap-animation.mp4';
import deepScalingVideo from './deep-scaling-animation.mp4';

// Keys are the actual services.service_id values, not catalogue list positions.
// Add one import and one entry here when a matching procedure video is ready.
const serviceVideos = {
  3: oralProphylaxisVideo, // Oral Prophylaxis
  4: toothFillingVideo, // Light-Cured Restoration (previously Tooth Filling)
  6: toothExtractionVideo, // Retained for Tooth Extraction history; not a replacement service.
  10: fixedBridgesVideo, // Fixed Bridges
  14: pedodonticsVideo, // Pedodontics Treatment
  18: inlayVideo, // Inlay
  19: onlayVideo, // Onlay
  22: emaxVeneersVideo, // Emax Veneers
  23: orthodonticsVideo, // Orthodontics
  26: mucosalFlapVideo, // Mucosal Flap
  27: deepScalingVideo, // Deep Scaling
};

// tooth-filling-alternate-animation.mp4 is retained as an alternate export.
// The clinic selected the existing tooth-filling-animation.mp4 for patients.
export default serviceVideos;

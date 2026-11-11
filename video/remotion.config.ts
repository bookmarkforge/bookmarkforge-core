import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setChromiumOpenGlRenderer("angle");
Config.setPublicDir("./public");

// Remotion's bundled Chrome Headless Shell has no Windows ARM64 build.
// Point REMOTION_BROWSER_EXECUTABLE at any Chromium-based browser
// (Chrome, Edge, Brave) to render on such machines.
const browserExe = process.env.REMOTION_BROWSER_EXECUTABLE;
if (browserExe) Config.setBrowserExecutable(browserExe);

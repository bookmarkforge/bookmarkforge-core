"use strict";

const Module = require("node:module");
const wasmRollup = require("@rollup/wasm-node");
const originalLoad = Module._load;

Module._load = function load(request, parent, isMain) {
  if (request === "rollup") return wasmRollup;
  return originalLoad.call(this, request, parent, isMain);
};

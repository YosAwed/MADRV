// ../webdev-static-assets/madrv-worklet-source/madrv-converter.mjs
var Module = (() => {
  var _scriptDir = import.meta.url;
  return (function(Module3) {
    Module3 = Module3 || {};
    var Module3 = typeof Module3 != "undefined" ? Module3 : {};
    var readyPromiseResolve, readyPromiseReject;
    Module3["ready"] = new Promise(function(resolve, reject) {
      readyPromiseResolve = resolve;
      readyPromiseReject = reject;
    });
    var moduleOverrides = Object.assign({}, Module3);
    var arguments_ = [];
    var thisProgram = "./this.program";
    var quit_ = (status, toThrow) => {
      throw toThrow;
    };
    var ENVIRONMENT_IS_WEB = true;
    var ENVIRONMENT_IS_WORKER = false;
    var scriptDirectory = "";
    function locateFile(path) {
      if (Module3["locateFile"]) {
        return Module3["locateFile"](path, scriptDirectory);
      }
      return scriptDirectory + path;
    }
    var read_, readAsync, readBinary, setWindowTitle;
    if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
      if (ENVIRONMENT_IS_WORKER) {
        scriptDirectory = self.location.href;
      } else if (typeof document != "undefined" && document.currentScript) {
        scriptDirectory = document.currentScript.src;
      }
      if (_scriptDir) {
        scriptDirectory = _scriptDir;
      }
      if (scriptDirectory.indexOf("blob:") !== 0) {
        scriptDirectory = scriptDirectory.substr(0, scriptDirectory.replace(/[?#].*/, "").lastIndexOf("/") + 1);
      } else {
        scriptDirectory = "";
      }
      {
        read_ = ((url) => {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", url, false);
          xhr.send(null);
          return xhr.responseText;
        });
        if (ENVIRONMENT_IS_WORKER) {
          readBinary = ((url) => {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url, false);
            xhr.responseType = "arraybuffer";
            xhr.send(null);
            return new Uint8Array(xhr.response);
          });
        }
        readAsync = ((url, onload, onerror) => {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", url, true);
          xhr.responseType = "arraybuffer";
          xhr.onload = (() => {
            if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
              onload(xhr.response);
              return;
            }
            onerror();
          });
          xhr.onerror = onerror;
          xhr.send(null);
        });
      }
      setWindowTitle = ((title) => document.title = title);
    } else {
    }
    var out = Module3["print"] || console.log.bind(console);
    var err = Module3["printErr"] || console.warn.bind(console);
    Object.assign(Module3, moduleOverrides);
    moduleOverrides = null;
    if (Module3["arguments"]) arguments_ = Module3["arguments"];
    if (Module3["thisProgram"]) thisProgram = Module3["thisProgram"];
    if (Module3["quit"]) quit_ = Module3["quit"];
    var wasmBinary;
    if (Module3["wasmBinary"]) wasmBinary = Module3["wasmBinary"];
    var noExitRuntime = Module3["noExitRuntime"] || true;
    if (typeof WebAssembly != "object") {
      abort("no native wasm support detected");
    }
    var wasmMemory;
    var ABORT = false;
    var EXITSTATUS;
    var buffer, HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
    function updateGlobalBufferAndViews(buf) {
      buffer = buf;
      Module3["HEAP8"] = HEAP8 = new Int8Array(buf);
      Module3["HEAP16"] = HEAP16 = new Int16Array(buf);
      Module3["HEAP32"] = HEAP32 = new Int32Array(buf);
      Module3["HEAPU8"] = HEAPU8 = new Uint8Array(buf);
      Module3["HEAPU16"] = HEAPU16 = new Uint16Array(buf);
      Module3["HEAPU32"] = HEAPU32 = new Uint32Array(buf);
      Module3["HEAPF32"] = HEAPF32 = new Float32Array(buf);
      Module3["HEAPF64"] = HEAPF64 = new Float64Array(buf);
    }
    var INITIAL_MEMORY = Module3["INITIAL_MEMORY"] || 16777216;
    var wasmTable;
    var __ATPRERUN__ = [];
    var __ATINIT__ = [];
    var __ATPOSTRUN__ = [];
    var runtimeInitialized = false;
    function preRun() {
      if (Module3["preRun"]) {
        if (typeof Module3["preRun"] == "function") Module3["preRun"] = [Module3["preRun"]];
        while (Module3["preRun"].length) {
          addOnPreRun(Module3["preRun"].shift());
        }
      }
      callRuntimeCallbacks(__ATPRERUN__);
    }
    function initRuntime() {
      runtimeInitialized = true;
      callRuntimeCallbacks(__ATINIT__);
    }
    function postRun() {
      if (Module3["postRun"]) {
        if (typeof Module3["postRun"] == "function") Module3["postRun"] = [Module3["postRun"]];
        while (Module3["postRun"].length) {
          addOnPostRun(Module3["postRun"].shift());
        }
      }
      callRuntimeCallbacks(__ATPOSTRUN__);
    }
    function addOnPreRun(cb) {
      __ATPRERUN__.unshift(cb);
    }
    function addOnInit(cb) {
      __ATINIT__.unshift(cb);
    }
    function addOnPostRun(cb) {
      __ATPOSTRUN__.unshift(cb);
    }
    var runDependencies = 0;
    var runDependencyWatcher = null;
    var dependenciesFulfilled = null;
    function addRunDependency(id) {
      runDependencies++;
      if (Module3["monitorRunDependencies"]) {
        Module3["monitorRunDependencies"](runDependencies);
      }
    }
    function removeRunDependency(id) {
      runDependencies--;
      if (Module3["monitorRunDependencies"]) {
        Module3["monitorRunDependencies"](runDependencies);
      }
      if (runDependencies == 0) {
        if (runDependencyWatcher !== null) {
          clearInterval(runDependencyWatcher);
          runDependencyWatcher = null;
        }
        if (dependenciesFulfilled) {
          var callback = dependenciesFulfilled;
          dependenciesFulfilled = null;
          callback();
        }
      }
    }
    Module3["preloadedImages"] = {};
    Module3["preloadedAudios"] = {};
    function abort(what) {
      {
        if (Module3["onAbort"]) {
          Module3["onAbort"](what);
        }
      }
      what = "Aborted(" + what + ")";
      err(what);
      ABORT = true;
      EXITSTATUS = 1;
      what += ". Build with -s ASSERTIONS=1 for more info.";
      var e = new WebAssembly.RuntimeError(what);
      readyPromiseReject(e);
      throw e;
    }
    var dataURIPrefix = "data:application/octet-stream;base64,";
    function isDataURI(filename) {
      return filename.startsWith(dataURIPrefix);
    }
    var wasmBinaryFile;
    if (Module3["locateFile"]) {
      wasmBinaryFile = "madrv-converter.wasm";
      if (!isDataURI(wasmBinaryFile)) {
        wasmBinaryFile = locateFile(wasmBinaryFile);
      }
    } else {
      wasmBinaryFile = new URL("madrv-converter.wasm", import.meta.url).toString();
    }
    function getBinary(file) {
      try {
        if (file == wasmBinaryFile && wasmBinary) {
          return new Uint8Array(wasmBinary);
        }
        if (readBinary) {
          return readBinary(file);
        } else {
          throw "both async and sync fetching of the wasm failed";
        }
      } catch (err2) {
        abort(err2);
      }
    }
    function getBinaryPromise() {
      if (!wasmBinary && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER)) {
        if (typeof fetch == "function") {
          return fetch(wasmBinaryFile, { credentials: "same-origin" }).then(function(response) {
            if (!response["ok"]) {
              throw "failed to load wasm binary file at '" + wasmBinaryFile + "'";
            }
            return response["arrayBuffer"]();
          }).catch(function() {
            return getBinary(wasmBinaryFile);
          });
        }
      }
      return Promise.resolve().then(function() {
        return getBinary(wasmBinaryFile);
      });
    }
    function createWasm() {
      var info = { "a": asmLibraryArg };
      function receiveInstance(instance, module) {
        var exports2 = instance.exports;
        Module3["asm"] = exports2;
        wasmMemory = Module3["asm"]["f"];
        updateGlobalBufferAndViews(wasmMemory.buffer);
        wasmTable = Module3["asm"]["l"];
        addOnInit(Module3["asm"]["g"]);
        removeRunDependency("wasm-instantiate");
      }
      addRunDependency("wasm-instantiate");
      function receiveInstantiationResult(result) {
        receiveInstance(result["instance"]);
      }
      function instantiateArrayBuffer(receiver) {
        return getBinaryPromise().then(function(binary) {
          return WebAssembly.instantiate(binary, info);
        }).then(function(instance) {
          return instance;
        }).then(receiver, function(reason) {
          err("failed to asynchronously prepare wasm: " + reason);
          abort(reason);
        });
      }
      function instantiateAsync() {
        if (!wasmBinary && typeof WebAssembly.instantiateStreaming == "function" && !isDataURI(wasmBinaryFile) && typeof fetch == "function") {
          return fetch(wasmBinaryFile, { credentials: "same-origin" }).then(function(response) {
            var result = WebAssembly.instantiateStreaming(response, info);
            return result.then(receiveInstantiationResult, function(reason) {
              err("wasm streaming compile failed: " + reason);
              err("falling back to ArrayBuffer instantiation");
              return instantiateArrayBuffer(receiveInstantiationResult);
            });
          });
        } else {
          return instantiateArrayBuffer(receiveInstantiationResult);
        }
      }
      if (Module3["instantiateWasm"]) {
        try {
          var exports = Module3["instantiateWasm"](info, receiveInstance);
          return exports;
        } catch (e) {
          err("Module.instantiateWasm callback failed with error: " + e);
          return false;
        }
      }
      instantiateAsync().catch(readyPromiseReject);
      return {};
    }
    function callRuntimeCallbacks(callbacks) {
      while (callbacks.length > 0) {
        var callback = callbacks.shift();
        if (typeof callback == "function") {
          callback(Module3);
          continue;
        }
        var func = callback.func;
        if (typeof func == "number") {
          if (callback.arg === void 0) {
            getWasmTableEntry(func)();
          } else {
            getWasmTableEntry(func)(callback.arg);
          }
        } else {
          func(callback.arg === void 0 ? null : callback.arg);
        }
      }
    }
    var wasmTableMirror = [];
    function getWasmTableEntry(funcPtr) {
      var func = wasmTableMirror[funcPtr];
      if (!func) {
        if (funcPtr >= wasmTableMirror.length) wasmTableMirror.length = funcPtr + 1;
        wasmTableMirror[funcPtr] = func = wasmTable.get(funcPtr);
      }
      return func;
    }
    function ___cxa_allocate_exception(size) {
      return _malloc(size + 16) + 16;
    }
    function ExceptionInfo(excPtr) {
      this.excPtr = excPtr;
      this.ptr = excPtr - 16;
      this.set_type = function(type) {
        HEAP32[this.ptr + 4 >> 2] = type;
      };
      this.get_type = function() {
        return HEAP32[this.ptr + 4 >> 2];
      };
      this.set_destructor = function(destructor) {
        HEAP32[this.ptr + 8 >> 2] = destructor;
      };
      this.get_destructor = function() {
        return HEAP32[this.ptr + 8 >> 2];
      };
      this.set_refcount = function(refcount) {
        HEAP32[this.ptr >> 2] = refcount;
      };
      this.set_caught = function(caught) {
        caught = caught ? 1 : 0;
        HEAP8[this.ptr + 12 >> 0] = caught;
      };
      this.get_caught = function() {
        return HEAP8[this.ptr + 12 >> 0] != 0;
      };
      this.set_rethrown = function(rethrown) {
        rethrown = rethrown ? 1 : 0;
        HEAP8[this.ptr + 13 >> 0] = rethrown;
      };
      this.get_rethrown = function() {
        return HEAP8[this.ptr + 13 >> 0] != 0;
      };
      this.init = function(type, destructor) {
        this.set_type(type);
        this.set_destructor(destructor);
        this.set_refcount(0);
        this.set_caught(false);
        this.set_rethrown(false);
      };
      this.add_ref = function() {
        var value = HEAP32[this.ptr >> 2];
        HEAP32[this.ptr >> 2] = value + 1;
      };
      this.release_ref = function() {
        var prev = HEAP32[this.ptr >> 2];
        HEAP32[this.ptr >> 2] = prev - 1;
        return prev === 1;
      };
    }
    var exceptionLast = 0;
    var uncaughtExceptionCount = 0;
    function ___cxa_throw(ptr, type, destructor) {
      var info = new ExceptionInfo(ptr);
      info.init(type, destructor);
      exceptionLast = ptr;
      uncaughtExceptionCount++;
      throw ptr;
    }
    function _abort() {
      abort("");
    }
    function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.copyWithin(dest, src, src + num);
    }
    function _emscripten_get_heap_max() {
      return 2147483648;
    }
    function emscripten_realloc_buffer(size) {
      try {
        wasmMemory.grow(size - buffer.byteLength + 65535 >>> 16);
        updateGlobalBufferAndViews(wasmMemory.buffer);
        return 1;
      } catch (e) {
      }
    }
    function _emscripten_resize_heap(requestedSize) {
      var oldSize = HEAPU8.length;
      requestedSize = requestedSize >>> 0;
      var maxHeapSize = _emscripten_get_heap_max();
      if (requestedSize > maxHeapSize) {
        return false;
      }
      let alignUp = (x, multiple) => x + (multiple - x % multiple) % multiple;
      for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
        var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
        overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
        var newSize = Math.min(maxHeapSize, alignUp(Math.max(requestedSize, overGrownHeapSize), 65536));
        var replacement = emscripten_realloc_buffer(newSize);
        if (replacement) {
          return true;
        }
      }
      return false;
    }
    var asmLibraryArg = { "b": ___cxa_allocate_exception, "a": ___cxa_throw, "c": _abort, "e": _emscripten_memcpy_big, "d": _emscripten_resize_heap };
    var asm = createWasm();
    var ___wasm_call_ctors = Module3["___wasm_call_ctors"] = function() {
      return (___wasm_call_ctors = Module3["___wasm_call_ctors"] = Module3["asm"]["g"]).apply(null, arguments);
    };
    var _madrv_convert_mdr = Module3["_madrv_convert_mdr"] = function() {
      return (_madrv_convert_mdr = Module3["_madrv_convert_mdr"] = Module3["asm"]["h"]).apply(null, arguments);
    };
    var _madrv_converted_size = Module3["_madrv_converted_size"] = function() {
      return (_madrv_converted_size = Module3["_madrv_converted_size"] = Module3["asm"]["i"]).apply(null, arguments);
    };
    var _madrv_copy_converted = Module3["_madrv_copy_converted"] = function() {
      return (_madrv_copy_converted = Module3["_madrv_copy_converted"] = Module3["asm"]["j"]).apply(null, arguments);
    };
    var _madrv_last_error = Module3["_madrv_last_error"] = function() {
      return (_madrv_last_error = Module3["_madrv_last_error"] = Module3["asm"]["k"]).apply(null, arguments);
    };
    var _malloc = Module3["_malloc"] = function() {
      return (_malloc = Module3["_malloc"] = Module3["asm"]["m"]).apply(null, arguments);
    };
    var _free = Module3["_free"] = function() {
      return (_free = Module3["_free"] = Module3["asm"]["n"]).apply(null, arguments);
    };
    var calledRun;
    dependenciesFulfilled = function runCaller() {
      if (!calledRun) run();
      if (!calledRun) dependenciesFulfilled = runCaller;
    };
    function run(args) {
      args = args || arguments_;
      if (runDependencies > 0) {
        return;
      }
      preRun();
      if (runDependencies > 0) {
        return;
      }
      function doRun() {
        if (calledRun) return;
        calledRun = true;
        Module3["calledRun"] = true;
        if (ABORT) return;
        initRuntime();
        readyPromiseResolve(Module3);
        if (Module3["onRuntimeInitialized"]) Module3["onRuntimeInitialized"]();
        postRun();
      }
      if (Module3["setStatus"]) {
        Module3["setStatus"]("Running...");
        setTimeout(function() {
          setTimeout(function() {
            Module3["setStatus"]("");
          }, 1);
          doRun();
        }, 1);
      } else {
        doRun();
      }
    }
    Module3["run"] = run;
    if (Module3["preInit"]) {
      if (typeof Module3["preInit"] == "function") Module3["preInit"] = [Module3["preInit"]];
      while (Module3["preInit"].length > 0) {
        Module3["preInit"].pop()();
      }
    }
    run();
    return Module3.ready;
  });
})();
var madrv_converter_default = Module;

// ../webdev-static-assets/madrv-worklet-source/madrv-mdx-player.mjs
var Module2 = (() => {
  var _scriptDir = import.meta.url;
  return (function(Module3) {
    Module3 = Module3 || {};
    var Module3 = typeof Module3 != "undefined" ? Module3 : {};
    var readyPromiseResolve, readyPromiseReject;
    Module3["ready"] = new Promise(function(resolve, reject) {
      readyPromiseResolve = resolve;
      readyPromiseReject = reject;
    });
    var moduleOverrides = Object.assign({}, Module3);
    var arguments_ = [];
    var thisProgram = "./this.program";
    var quit_ = (status, toThrow) => {
      throw toThrow;
    };
    var ENVIRONMENT_IS_WEB = true;
    var ENVIRONMENT_IS_WORKER = false;
    var scriptDirectory = "";
    function locateFile(path) {
      if (Module3["locateFile"]) {
        return Module3["locateFile"](path, scriptDirectory);
      }
      return scriptDirectory + path;
    }
    var read_, readAsync, readBinary, setWindowTitle;
    if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
      if (ENVIRONMENT_IS_WORKER) {
        scriptDirectory = self.location.href;
      } else if (typeof document != "undefined" && document.currentScript) {
        scriptDirectory = document.currentScript.src;
      }
      if (_scriptDir) {
        scriptDirectory = _scriptDir;
      }
      if (scriptDirectory.indexOf("blob:") !== 0) {
        scriptDirectory = scriptDirectory.substr(0, scriptDirectory.replace(/[?#].*/, "").lastIndexOf("/") + 1);
      } else {
        scriptDirectory = "";
      }
      {
        read_ = ((url) => {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", url, false);
          xhr.send(null);
          return xhr.responseText;
        });
        if (ENVIRONMENT_IS_WORKER) {
          readBinary = ((url) => {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url, false);
            xhr.responseType = "arraybuffer";
            xhr.send(null);
            return new Uint8Array(xhr.response);
          });
        }
        readAsync = ((url, onload, onerror) => {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", url, true);
          xhr.responseType = "arraybuffer";
          xhr.onload = (() => {
            if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
              onload(xhr.response);
              return;
            }
            onerror();
          });
          xhr.onerror = onerror;
          xhr.send(null);
        });
      }
      setWindowTitle = ((title) => document.title = title);
    } else {
    }
    var out = Module3["print"] || console.log.bind(console);
    var err = Module3["printErr"] || console.warn.bind(console);
    Object.assign(Module3, moduleOverrides);
    moduleOverrides = null;
    if (Module3["arguments"]) arguments_ = Module3["arguments"];
    if (Module3["thisProgram"]) thisProgram = Module3["thisProgram"];
    if (Module3["quit"]) quit_ = Module3["quit"];
    var wasmBinary;
    if (Module3["wasmBinary"]) wasmBinary = Module3["wasmBinary"];
    var noExitRuntime = Module3["noExitRuntime"] || true;
    if (typeof WebAssembly != "object") {
      abort("no native wasm support detected");
    }
    var wasmMemory;
    var ABORT = false;
    var EXITSTATUS;
    var UTF8Decoder = typeof TextDecoder != "undefined" ? new TextDecoder("utf8") : void 0;
    function UTF8ArrayToString(heap, idx, maxBytesToRead) {
      var endIdx = idx + maxBytesToRead;
      var endPtr = idx;
      while (heap[endPtr] && !(endPtr >= endIdx)) ++endPtr;
      if (endPtr - idx > 16 && heap.subarray && UTF8Decoder) {
        return UTF8Decoder.decode(heap.subarray(idx, endPtr));
      } else {
        var str = "";
        while (idx < endPtr) {
          var u0 = heap[idx++];
          if (!(u0 & 128)) {
            str += String.fromCharCode(u0);
            continue;
          }
          var u1 = heap[idx++] & 63;
          if ((u0 & 224) == 192) {
            str += String.fromCharCode((u0 & 31) << 6 | u1);
            continue;
          }
          var u2 = heap[idx++] & 63;
          if ((u0 & 240) == 224) {
            u0 = (u0 & 15) << 12 | u1 << 6 | u2;
          } else {
            u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heap[idx++] & 63;
          }
          if (u0 < 65536) {
            str += String.fromCharCode(u0);
          } else {
            var ch = u0 - 65536;
            str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
          }
        }
      }
      return str;
    }
    function UTF8ToString(ptr, maxBytesToRead) {
      return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
    }
    var buffer, HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
    function updateGlobalBufferAndViews(buf) {
      buffer = buf;
      Module3["HEAP8"] = HEAP8 = new Int8Array(buf);
      Module3["HEAP16"] = HEAP16 = new Int16Array(buf);
      Module3["HEAP32"] = HEAP32 = new Int32Array(buf);
      Module3["HEAPU8"] = HEAPU8 = new Uint8Array(buf);
      Module3["HEAPU16"] = HEAPU16 = new Uint16Array(buf);
      Module3["HEAPU32"] = HEAPU32 = new Uint32Array(buf);
      Module3["HEAPF32"] = HEAPF32 = new Float32Array(buf);
      Module3["HEAPF64"] = HEAPF64 = new Float64Array(buf);
    }
    var INITIAL_MEMORY = Module3["INITIAL_MEMORY"] || 16777216;
    var wasmTable;
    var __ATPRERUN__ = [];
    var __ATINIT__ = [];
    var __ATPOSTRUN__ = [];
    var runtimeInitialized = false;
    function preRun() {
      if (Module3["preRun"]) {
        if (typeof Module3["preRun"] == "function") Module3["preRun"] = [Module3["preRun"]];
        while (Module3["preRun"].length) {
          addOnPreRun(Module3["preRun"].shift());
        }
      }
      callRuntimeCallbacks(__ATPRERUN__);
    }
    function initRuntime() {
      runtimeInitialized = true;
      callRuntimeCallbacks(__ATINIT__);
    }
    function postRun() {
      if (Module3["postRun"]) {
        if (typeof Module3["postRun"] == "function") Module3["postRun"] = [Module3["postRun"]];
        while (Module3["postRun"].length) {
          addOnPostRun(Module3["postRun"].shift());
        }
      }
      callRuntimeCallbacks(__ATPOSTRUN__);
    }
    function addOnPreRun(cb) {
      __ATPRERUN__.unshift(cb);
    }
    function addOnInit(cb) {
      __ATINIT__.unshift(cb);
    }
    function addOnPostRun(cb) {
      __ATPOSTRUN__.unshift(cb);
    }
    var runDependencies = 0;
    var runDependencyWatcher = null;
    var dependenciesFulfilled = null;
    function addRunDependency(id) {
      runDependencies++;
      if (Module3["monitorRunDependencies"]) {
        Module3["monitorRunDependencies"](runDependencies);
      }
    }
    function removeRunDependency(id) {
      runDependencies--;
      if (Module3["monitorRunDependencies"]) {
        Module3["monitorRunDependencies"](runDependencies);
      }
      if (runDependencies == 0) {
        if (runDependencyWatcher !== null) {
          clearInterval(runDependencyWatcher);
          runDependencyWatcher = null;
        }
        if (dependenciesFulfilled) {
          var callback = dependenciesFulfilled;
          dependenciesFulfilled = null;
          callback();
        }
      }
    }
    Module3["preloadedImages"] = {};
    Module3["preloadedAudios"] = {};
    function abort(what) {
      {
        if (Module3["onAbort"]) {
          Module3["onAbort"](what);
        }
      }
      what = "Aborted(" + what + ")";
      err(what);
      ABORT = true;
      EXITSTATUS = 1;
      what += ". Build with -s ASSERTIONS=1 for more info.";
      var e = new WebAssembly.RuntimeError(what);
      readyPromiseReject(e);
      throw e;
    }
    var dataURIPrefix = "data:application/octet-stream;base64,";
    function isDataURI(filename) {
      return filename.startsWith(dataURIPrefix);
    }
    var wasmBinaryFile;
    if (Module3["locateFile"]) {
      wasmBinaryFile = "madrv-mdx-player-v9.wasm";
      if (!isDataURI(wasmBinaryFile)) {
        wasmBinaryFile = locateFile(wasmBinaryFile);
      }
    } else {
      wasmBinaryFile = new URL("madrv-mdx-player-v9.wasm", import.meta.url).toString();
    }
    function getBinary(file) {
      try {
        if (file == wasmBinaryFile && wasmBinary) {
          return new Uint8Array(wasmBinary);
        }
        if (readBinary) {
          return readBinary(file);
        } else {
          throw "both async and sync fetching of the wasm failed";
        }
      } catch (err2) {
        abort(err2);
      }
    }
    function getBinaryPromise() {
      if (!wasmBinary && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER)) {
        if (typeof fetch == "function") {
          return fetch(wasmBinaryFile, { credentials: "same-origin" }).then(function(response) {
            if (!response["ok"]) {
              throw "failed to load wasm binary file at '" + wasmBinaryFile + "'";
            }
            return response["arrayBuffer"]();
          }).catch(function() {
            return getBinary(wasmBinaryFile);
          });
        }
      }
      return Promise.resolve().then(function() {
        return getBinary(wasmBinaryFile);
      });
    }
    function createWasm() {
      var info = { "a": asmLibraryArg };
      function receiveInstance(instance, module) {
        var exports2 = instance.exports;
        Module3["asm"] = exports2;
        wasmMemory = Module3["asm"]["d"];
        updateGlobalBufferAndViews(wasmMemory.buffer);
        wasmTable = Module3["asm"]["v"];
        addOnInit(Module3["asm"]["e"]);
        removeRunDependency("wasm-instantiate");
      }
      addRunDependency("wasm-instantiate");
      function receiveInstantiationResult(result) {
        receiveInstance(result["instance"]);
      }
      function instantiateArrayBuffer(receiver) {
        return getBinaryPromise().then(function(binary) {
          return WebAssembly.instantiate(binary, info);
        }).then(function(instance) {
          return instance;
        }).then(receiver, function(reason) {
          err("failed to asynchronously prepare wasm: " + reason);
          abort(reason);
        });
      }
      function instantiateAsync() {
        if (!wasmBinary && typeof WebAssembly.instantiateStreaming == "function" && !isDataURI(wasmBinaryFile) && typeof fetch == "function") {
          return fetch(wasmBinaryFile, { credentials: "same-origin" }).then(function(response) {
            var result = WebAssembly.instantiateStreaming(response, info);
            return result.then(receiveInstantiationResult, function(reason) {
              err("wasm streaming compile failed: " + reason);
              err("falling back to ArrayBuffer instantiation");
              return instantiateArrayBuffer(receiveInstantiationResult);
            });
          });
        } else {
          return instantiateArrayBuffer(receiveInstantiationResult);
        }
      }
      if (Module3["instantiateWasm"]) {
        try {
          var exports = Module3["instantiateWasm"](info, receiveInstance);
          return exports;
        } catch (e) {
          err("Module.instantiateWasm callback failed with error: " + e);
          return false;
        }
      }
      instantiateAsync().catch(readyPromiseReject);
      return {};
    }
    function callRuntimeCallbacks(callbacks) {
      while (callbacks.length > 0) {
        var callback = callbacks.shift();
        if (typeof callback == "function") {
          callback(Module3);
          continue;
        }
        var func = callback.func;
        if (typeof func == "number") {
          if (callback.arg === void 0) {
            getWasmTableEntry(func)();
          } else {
            getWasmTableEntry(func)(callback.arg);
          }
        } else {
          func(callback.arg === void 0 ? null : callback.arg);
        }
      }
    }
    var wasmTableMirror = [];
    function getWasmTableEntry(funcPtr) {
      var func = wasmTableMirror[funcPtr];
      if (!func) {
        if (funcPtr >= wasmTableMirror.length) wasmTableMirror.length = funcPtr + 1;
        wasmTableMirror[funcPtr] = func = wasmTable.get(funcPtr);
      }
      return func;
    }
    function ___assert_fail(condition, filename, line, func) {
      abort("Assertion failed: " + UTF8ToString(condition) + ", at: " + [filename ? UTF8ToString(filename) : "unknown filename", line, func ? UTF8ToString(func) : "unknown function"]);
    }
    function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.copyWithin(dest, src, src + num);
    }
    function _emscripten_get_heap_max() {
      return 2147483648;
    }
    function emscripten_realloc_buffer(size) {
      try {
        wasmMemory.grow(size - buffer.byteLength + 65535 >>> 16);
        updateGlobalBufferAndViews(wasmMemory.buffer);
        return 1;
      } catch (e) {
      }
    }
    function _emscripten_resize_heap(requestedSize) {
      var oldSize = HEAPU8.length;
      requestedSize = requestedSize >>> 0;
      var maxHeapSize = _emscripten_get_heap_max();
      if (requestedSize > maxHeapSize) {
        return false;
      }
      let alignUp = (x, multiple) => x + (multiple - x % multiple) % multiple;
      for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
        var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
        overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
        var newSize = Math.min(maxHeapSize, alignUp(Math.max(requestedSize, overGrownHeapSize), 65536));
        var replacement = emscripten_realloc_buffer(newSize);
        if (replacement) {
          return true;
        }
      }
      return false;
    }
    var asmLibraryArg = { "c": ___assert_fail, "b": _emscripten_memcpy_big, "a": _emscripten_resize_heap };
    var asm = createWasm();
    var ___wasm_call_ctors = Module3["___wasm_call_ctors"] = function() {
      return (___wasm_call_ctors = Module3["___wasm_call_ctors"] = Module3["asm"]["e"]).apply(null, arguments);
    };
    var _mdx_player_init = Module3["_mdx_player_init"] = function() {
      return (_mdx_player_init = Module3["_mdx_player_init"] = Module3["asm"]["f"]).apply(null, arguments);
    };
    var _mdx_player_load = Module3["_mdx_player_load"] = function() {
      return (_mdx_player_load = Module3["_mdx_player_load"] = Module3["asm"]["g"]).apply(null, arguments);
    };
    var _free = Module3["_free"] = function() {
      return (_free = Module3["_free"] = Module3["asm"]["h"]).apply(null, arguments);
    };
    var _malloc = Module3["_malloc"] = function() {
      return (_malloc = Module3["_malloc"] = Module3["asm"]["i"]).apply(null, arguments);
    };
    var _mdx_player_measure = Module3["_mdx_player_measure"] = function() {
      return (_mdx_player_measure = Module3["_mdx_player_measure"] = Module3["asm"]["j"]).apply(null, arguments);
    };
    var _mdx_player_play = Module3["_mdx_player_play"] = function() {
      return (_mdx_player_play = Module3["_mdx_player_play"] = Module3["asm"]["k"]).apply(null, arguments);
    };
    var _mdx_player_render = Module3["_mdx_player_render"] = function() {
      return (_mdx_player_render = Module3["_mdx_player_render"] = Module3["asm"]["l"]).apply(null, arguments);
    };
    var _mdx_player_get_pcm_active_mask = Module3["_mdx_player_get_pcm_active_mask"] = function() {
      return (_mdx_player_get_pcm_active_mask = Module3["_mdx_player_get_pcm_active_mask"] = Module3["asm"]["m"]).apply(null, arguments);
    };
    var _mdx_player_get_hardware_track_note_raw = Module3["_mdx_player_get_hardware_track_note_raw"] = function() {
      return (_mdx_player_get_hardware_track_note_raw = Module3["_mdx_player_get_hardware_track_note_raw"] = Module3["asm"]["n"]).apply(null, arguments);
    };
    var _mdx_player_get_timer_b = Module3["_mdx_player_get_timer_b"] = function() {
      return (_mdx_player_get_timer_b = Module3["_mdx_player_get_timer_b"] = Module3["asm"]["o"]).apply(null, arguments);
    };
    var _mdx_player_seek = Module3["_mdx_player_seek"] = function() {
      return (_mdx_player_seek = Module3["_mdx_player_seek"] = Module3["asm"]["p"]).apply(null, arguments);
    };
    var _mdx_player_stop = Module3["_mdx_player_stop"] = function() {
      return (_mdx_player_stop = Module3["_mdx_player_stop"] = Module3["asm"]["q"]).apply(null, arguments);
    };
    var _mdx_player_set_channel_mask = Module3["_mdx_player_set_channel_mask"] = function() {
      return (_mdx_player_set_channel_mask = Module3["_mdx_player_set_channel_mask"] = Module3["asm"]["r"]).apply(null, arguments);
    };
    var _mdx_player_get_channel_mask = Module3["_mdx_player_get_channel_mask"] = function() {
      return (_mdx_player_get_channel_mask = Module3["_mdx_player_get_channel_mask"] = Module3["asm"]["s"]).apply(null, arguments);
    };
    var _mdx_player_last_error = Module3["_mdx_player_last_error"] = function() {
      return (_mdx_player_last_error = Module3["_mdx_player_last_error"] = Module3["asm"]["t"]).apply(null, arguments);
    };
    var _mdx_player_dispose = Module3["_mdx_player_dispose"] = function() {
      return (_mdx_player_dispose = Module3["_mdx_player_dispose"] = Module3["asm"]["u"]).apply(null, arguments);
    };
    var calledRun;
    dependenciesFulfilled = function runCaller() {
      if (!calledRun) run();
      if (!calledRun) dependenciesFulfilled = runCaller;
    };
    function run(args) {
      args = args || arguments_;
      if (runDependencies > 0) {
        return;
      }
      preRun();
      if (runDependencies > 0) {
        return;
      }
      function doRun() {
        if (calledRun) return;
        calledRun = true;
        Module3["calledRun"] = true;
        if (ABORT) return;
        initRuntime();
        readyPromiseResolve(Module3);
        if (Module3["onRuntimeInitialized"]) Module3["onRuntimeInitialized"]();
        postRun();
      }
      if (Module3["setStatus"]) {
        Module3["setStatus"]("Running...");
        setTimeout(function() {
          setTimeout(function() {
            Module3["setStatus"]("");
          }, 1);
          doRun();
        }, 1);
      } else {
        doRun();
      }
    }
    Module3["run"] = run;
    if (Module3["preInit"]) {
      if (typeof Module3["preInit"] == "function") Module3["preInit"] = [Module3["preInit"]];
      while (Module3["preInit"].length > 0) {
        Module3["preInit"].pop()();
      }
    }
    run();
    return Module3.ready;
  });
})();
var madrv_mdx_player_default = Module2;

// ../webdev-static-assets/madrv-worklet-source/madrv-mdx-worklet-entry.js
var MadrvMdxRendererProcessor = class extends AudioWorkletProcessor {
  constructor() {
    super();
    this.converter = void 0;
    this.player = void 0;
    this.active = false;
    this.outputPointer = 0;
    this.outputCapacity = 0;
    this.lastStatusFrame = 0;
    this.generation = 0;
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }
  async ensureModules(wasm) {
    if (!wasm?.converter || !wasm?.player) throw new Error("AudioWorklet\u306EWASM\u30D0\u30A4\u30CA\u30EA\u304C\u4E0D\u8DB3\u3057\u3066\u3044\u307E\u3059\u3002");
    this.converter ??= await madrv_converter_default({ wasmBinary: wasm.converter, locateFile: () => "" });
    this.player ??= await madrv_mdx_player_default({ wasmBinary: wasm.player, locateFile: () => "" });
  }
  copyTo(module, bytes) {
    const pointer = module._malloc(bytes.byteLength);
    module.HEAPU8.set(new Uint8Array(bytes), pointer);
    return pointer;
  }
  async configure(data) {
    const generation = ++this.generation;
    this.active = false;
    try {
      await this.ensureModules(data.wasm);
      if (generation !== this.generation) return;
      if (this.player._mdx_player_init(data.sampleRate) !== 0) throw new Error("OPM\uFF0FPDX\u518D\u751F\u30B3\u30A2\u3092\u521D\u671F\u5316\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
      let mdxBytes;
      if (data.format === "mdr") {
        const source = new Uint8Array(data.source);
        const sourcePointer = this.copyTo(this.converter, data.source);
        try {
          const convertedSize = this.converter._madrv_convert_mdr(sourcePointer, source.byteLength);
          if (convertedSize <= 0) throw new Error("MDR\u3092\u518D\u751F\u7528\u30C7\u30FC\u30BF\u3078\u5909\u63DB\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
          const convertedPointer = this.converter._malloc(convertedSize);
          try {
            if (this.converter._madrv_copy_converted(convertedPointer, convertedSize) !== convertedSize) throw new Error("MDR\u5909\u63DB\u30C7\u30FC\u30BF\u306E\u8AAD\u8FBC\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002");
            mdxBytes = this.converter.HEAPU8.slice(convertedPointer, convertedPointer + convertedSize);
          } finally {
            this.converter._free(convertedPointer);
          }
        } finally {
          this.converter._free(sourcePointer);
        }
      } else {
        mdxBytes = new Uint8Array(data.source);
      }
      const pdxBytes = data.pdx ? new Uint8Array(data.pdx) : new Uint8Array();
      const mdxPointer = this.copyTo(this.player, mdxBytes);
      const pdxPointer = pdxBytes.byteLength ? this.copyTo(this.player, pdxBytes) : 0;
      try {
        if (this.player._mdx_player_load(mdxPointer, mdxBytes.byteLength, pdxPointer, pdxBytes.byteLength) !== 0) throw new Error("\u518D\u751F\u30B3\u30A2\u3078\u66F2\u30C7\u30FC\u30BF\u3092\u8A2D\u5B9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
      } finally {
        this.player._free(mdxPointer);
        if (pdxPointer) this.player._free(pdxPointer);
      }
      if (generation !== this.generation) return;
      this.player._mdx_player_play();
      this.active = true;
      this.port.postMessage({ type: "ready" });
    } catch (error) {
      if (generation === this.generation) this.port.postMessage({ type: "error", message: error instanceof Error ? error.message : "AudioWorklet\u306E\u521D\u671F\u5316\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002" });
    }
  }
  handleMessage(data) {
    if (data?.type === "configure") void this.configure(data);
    if (data?.type === "channel-mask" && this.player) this.player._mdx_player_set_channel_mask(data.mask >>> 0);
    if (data?.type === "stop") {
      this.generation += 1;
      if (this.player && this.active) this.player._mdx_player_stop();
      this.active = false;
    }
  }
  ensureOutputCapacity(frames) {
    const requiredBytes = frames * 4;
    if (this.outputPointer && this.outputCapacity >= requiredBytes) return;
    if (this.outputPointer) this.player._free(this.outputPointer);
    this.outputPointer = this.player._malloc(requiredBytes);
    this.outputCapacity = requiredBytes;
  }
  emitStatus(peak) {
    if (!this.player || currentFrame - this.lastStatusFrame < sampleRate / 8) return;
    this.lastStatusFrame = currentFrame;
    const keys = [];
    if (typeof this.player._mdx_player_get_hardware_track_note_raw === "function") {
      for (let track = 0; track < 32; track += 1) keys.push(this.player._mdx_player_get_hardware_track_note_raw(track));
    }
    const timer = typeof this.player._mdx_player_get_timer_b === "function" ? this.player._mdx_player_get_timer_b() : -1;
    this.port.postMessage({ type: "status", pcmMask: this.player._mdx_player_get_pcm_active_mask(), timer, keys, peak });
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1];
    if (!left || !right) return true;
    if (!this.active || !this.player) {
      left.fill(0);
      right.fill(0);
      return true;
    }
    this.ensureOutputCapacity(left.length);
    if (this.player._mdx_player_render(this.outputPointer, left.length) < 0) {
      left.fill(0);
      right.fill(0);
      return true;
    }
    const samples = this.player.HEAP16;
    const offset = this.outputPointer >> 1;
    let peak = 0;
    for (let index = 0; index < left.length; index += 1) {
      const leftSample = samples[offset + index * 2] ?? 0;
      const rightSample = samples[offset + index * 2 + 1] ?? 0;
      const leftMagnitude = Math.abs(leftSample);
      const rightMagnitude = Math.abs(rightSample);
      if (leftMagnitude > peak) peak = leftMagnitude;
      if (rightMagnitude > peak) peak = rightMagnitude;
      left[index] = leftSample / 32768;
      right[index] = rightSample / 32768;
    }
    this.emitStatus(peak);
    return true;
  }
};
registerProcessor("madrv-mdx-renderer", MadrvMdxRendererProcessor);

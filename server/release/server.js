(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var os = require('os');
var sysPath = require('path');
var fsevents, recursiveReaddir;
try {
  fsevents = require('fsevents');
  recursiveReaddir = require('recursive-readdir');
} catch (error) {}

var __slice = [].slice;
var createFSEventsInstance = function(path, callback) {
  var watcher = new fsevents.FSEvents(path);
  watcher.on('fsevent', callback);
  return watcher;
};
var nodeVersion = process.versions.node.substring(0, 3);
var directoryEndRe = /[\\\/]$/;
var platform = os.platform();
var canUseFsEvents = platform === 'darwin' && fsevents;

// To disable FSEvents completely.
// var canUseFsEvents = false;

// Binary file handling code.
var _binExts = ['adp', 'au', 'mid', 'mp4a', 'mpga', 'oga', 's3m', 'sil', 'eol', 'dra', 'dts', 'dtshd', 'lvp', 'pya', 'ecelp4800', 'ecelp7470', 'ecelp9600', 'rip', 'weba', 'aac', 'aif', 'caf', 'flac', 'mka', 'm3u', 'wax', 'wma', 'wav', 'xm', 'flac', '3gp', '3g2', 'h261', 'h263', 'h264', 'jpgv', 'jpm', 'mj2', 'mp4', 'mpeg', 'ogv', 'qt', 'uvh', 'uvm', 'uvp', 'uvs', 'dvb', 'fvt', 'mxu', 'pyv', 'uvu', 'viv', 'webm', 'f4v', 'fli', 'flv', 'm4v', 'mkv', 'mng', 'asf', 'vob', 'wm', 'wmv', 'wmx', 'wvx', 'movie', 'smv', 'ts', 'bmp', 'cgm', 'g3', 'gif', 'ief', 'jpg', 'jpeg', 'ktx', 'png', 'btif', 'sgi', 'svg', 'tiff', 'psd', 'uvi', 'sub', 'djvu', 'dwg', 'dxf', 'fbs', 'fpx', 'fst', 'mmr', 'rlc', 'mdi', 'wdp', 'npx', 'wbmp', 'xif', 'webp', '3ds', 'ras', 'cmx', 'fh', 'ico', 'pcx', 'pic', 'pnm', 'pbm', 'pgm', 'ppm', 'rgb', 'tga', 'xbm', 'xpm', 'xwd', 'zip', 'rar', 'tar', 'bz2', 'eot', 'ttf', 'woff'];
var binExts = Object.create(null);

_binExts.forEach(function(extension) {
  return binExts[extension] = true;
});

var isBinary = function(extension) {
  if (extension === '') return false;
  return !!binExts[extension];
}

var isBinaryPath = function(path) {
  return isBinary(sysPath.extname(path).slice(1));
};

exports.isBinaryPath = isBinaryPath;

// Main code.
//
// Watches files & directories for changes.
//
// Emitted events: `add`, `change`, `unlink`, `error`.
//
// Examples
//
//   var watcher = new FSWatcher()
//     .add(directories)
//     .on('add', function(path) {console.log('File', path, 'was added');})
//     .on('change', function(path) {console.log('File', path, 'was changed');})
//     .on('unlink', function(path) {console.log('File', path, 'was removed');})
//
function FSWatcher(_opts) {
  if (_opts == null) _opts = {};
  var opts = {};
  for (var opt in _opts) opts[opt] = _opts[opt]
  this.close = this.close.bind(this);
  EventEmitter.call(this);
  this.watched = Object.create(null);
  this.watchers = [];

  // Set up default options.
  if (opts.persistent == null) opts.persistent = false;
  if (opts.ignoreInitial == null) opts.ignoreInitial = false;
  if (opts.interval == null) opts.interval = 100;
  if (opts.binaryInterval == null) opts.binaryInterval = 300;
  if (opts.usePolling == null) opts.usePolling = platform !== 'win32';
  if (opts.useFsEvents == null) {
    opts.useFsEvents = !opts.usePolling && canUseFsEvents;
  } else {
    if (!canUseFsEvents) opts.useFsEvents = false;
  }
  if (opts.ignorePermissionErrors == null) {
    opts.ignorePermissionErrors = false;
  }

  this.enableBinaryInterval = opts.binaryInterval !== opts.interval;

  this._isIgnored = (function(ignored) {
    switch (toString.call(ignored)) {
      case '[object RegExp]':
        return function(string) {
          return ignored.test(string);
        };
      case '[object Function]':
        return ignored;
      default:
        return function() {
          return false;
        };
    }
  })(opts.ignored);

  this.options = opts;

  // You’re frozen when your heart’s not open.
  Object.freeze(opts);
}

FSWatcher.prototype = Object.create(EventEmitter.prototype);

// Directory helpers
// -----------------

FSWatcher.prototype._getWatchedDir = function(directory) {
  var dir, _base;
  dir = directory.replace(directoryEndRe, '');
  return (_base = this.watched)[dir] != null ? (_base = this.watched)[dir] : _base[dir] = [];
};

FSWatcher.prototype._addToWatchedDir = function(directory, basename) {
  var watchedFiles;
  watchedFiles = this._getWatchedDir(directory);
  return watchedFiles.push(basename);
};

FSWatcher.prototype._removeFromWatchedDir = function(directory, file) {
  var watchedFiles;
  watchedFiles = this._getWatchedDir(directory);
  return watchedFiles.some(function(watchedFile, index) {
    if (watchedFile === file) {
      watchedFiles.splice(index, 1);
      return true;
    }
  });
};

// File helpers
// ------------

// Private: Check for read permissions
// Based on this answer on SO: http://stackoverflow.com/a/11781404/1358405
//
// stats - fs.Stats object
//
// Returns Boolean
FSWatcher.prototype._hasReadPermissions = function(stats) {
  return Boolean(4 & parseInt((stats.mode & 0x1ff).toString(8)[0]));
};

// Private: Handles emitting unlink events for
// files and directories, and via recursion, for
// files and directories within directories that are unlinked
//
// directory - string, directory within which the following item is located
// item      - string, base path of item/directory
//
// Returns nothing.
FSWatcher.prototype._remove = function(directory, item) {
  // if what is being deleted is a directory, get that directory's paths
  // for recursive deleting and cleaning of watched object
  // if it is not a directory, nestedDirectoryChildren will be empty array
  var fullPath, isDirectory, nestedDirectoryChildren,
    _this = this;
  fullPath = sysPath.join(directory, item);
  isDirectory = this.watched[fullPath];

  // This will create a new entry in the watched object in either case
  // so we got to do the directory check beforehand
  nestedDirectoryChildren = this._getWatchedDir(fullPath).slice();

  // Remove directory / file from watched list.
  this._removeFromWatchedDir(directory, item);

  // Recursively remove children directories / files.
  nestedDirectoryChildren.forEach(function(nestedItem) {
    return _this._remove(fullPath, nestedItem);
  });

  if (this.options.usePolling) fs.unwatchFile(fullPath);

  // The Entry will either be a directory that just got removed
  // or a bogus entry to a file, in either case we have to remove it
  delete this.watched[fullPath];
  var eventName = isDirectory ? 'unlinkDir' : 'unlink';
  this.emit(eventName, fullPath);
};

FSWatcher.prototype._watchWithFsEvents = function(path) {
  var watcher,
    _this = this;
  watcher = createFSEventsInstance(path, function(path, flags) {
    var emit, info;
    if (_this._isIgnored(path)) {
      return;
    }
    info = fsevents.getInfo(path, flags);
    emit = function(event) {
      var name;
      name = info.type === 'file' ? event : "" + event + "Dir";
      if (event === 'add' || event === 'addDir') {
        _this._addToWatchedDir(sysPath.dirname(path), sysPath.basename(path));
      } else if (event === 'unlink' || event === 'unlinkDir') {
        _this._remove(sysPath.dirname(path), sysPath.basename(path));
        return; // Don't emit event twice.
      }
      return _this.emit(name, path);
    };
    switch (info.event) {
      case 'created':
        return emit('add');
      case 'modified':
        return emit('change');
      case 'deleted':
        return emit('unlink');
      case 'moved':
        return fs.stat(path, function(error, stats) {
          return emit((error || !stats ? 'unlink' : 'add'));
        });
    }
  });
  return this.watchers.push(watcher);
};

// Private: Watch file for changes with fs.watchFile or fs.watch.

// item     - string, path to file or directory.
// callback - function that will be executed on fs change.

// Returns nothing.
FSWatcher.prototype._watch = function(item, callback) {
  var basename, directory, options, parent, watcher;
  if (callback == null) {
    callback = (function() {});
  }
  directory = sysPath.dirname(item);
  basename = sysPath.basename(item);
  parent = this._getWatchedDir(directory);
  if (parent.indexOf(basename) !== -1) {
    return;
  }
  this._addToWatchedDir(directory, basename);
  options = {
    persistent: this.options.persistent
  };
  if (this.options.usePolling) {
    options.interval = this.enableBinaryInterval && isBinaryPath(basename) ? this.options.binaryInterval : this.options.interval;
    return fs.watchFile(item, options, function(curr, prev) {
      if (curr.mtime.getTime() > prev.mtime.getTime()) {
        return callback(item, curr);
      }
    });
  } else {
    watcher = fs.watch(item, options, function(event, path) {
      return callback(item);
    });
    return this.watchers.push(watcher);
  }
};

// Private: Emit `change` event once and watch file to emit it in the future
// once the file is changed.

// file       - string, fs path.
// stats      - object, result of executing stat(1) on file.
// initialAdd - boolean, was the file added at the launch?

// Returns nothing.
FSWatcher.prototype._handleFile = function(file, stats, initialAdd) {
  var _this = this;
  if (initialAdd == null) {
    initialAdd = false;
  }
  this._watch(file, function(file, newStats) {
    return _this.emit('change', file, newStats);
  });
  if (!(initialAdd && this.options.ignoreInitial)) {
    return this.emit('add', file, stats);
  }
};

// Private: Read directory to add / remove files from `@watched` list
// and re-read it on change.

// directory - string, fs path.

// Returns nothing.
FSWatcher.prototype._handleDir = function(directory, stats, initialAdd) {
  var read,
    _this = this;
  read = function(directory, initialAdd) {
    return fs.readdir(directory, function(error, current) {
      var previous;
      if (error != null) {
        return _this.emit('error', error);
      }
      if (!current) {
        return;
      }

      previous = _this._getWatchedDir(directory);

      // Files that absent in current directory snapshot
      // but present in previous emit `remove` event
      // and are removed from @watched[directory].
      previous.filter(function(file) {
        return current.indexOf(file) === -1;
      }).forEach(function(file) {
        return _this._remove(directory, file);
      });

      // Files that present in current directory snapshot
      // but absent in previous are added to watch list and
      // emit `add` event.
      current.filter(function(file) {
        return previous.indexOf(file) === -1;
      }).forEach(function(file) {
        _this._handle(sysPath.join(directory, file), initialAdd);
      });
    });
  };
  read(directory, initialAdd);
  this._watch(directory, function(dir) {
    return read(dir, false);
  });
  if (!(initialAdd && this.options.ignoreInitial)) {
    return this.emit('addDir', directory, stats);
  }
};

// Private: Handle added file or directory.
// Delegates call to _handleFile / _handleDir after checks.

// item - string, path to file or directory.

// Returns nothing.
FSWatcher.prototype._handle = function(item, initialAdd) {
  var _this = this;
  if (this._isIgnored(item)) {
    return;
  }
  return fs.realpath(item, function(error, path) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    if (error != null) {
      return _this.emit('error', error);
    }
    return fs.stat(path, function(error, stats) {
      if (error != null) {
        return _this.emit('error', error);
      }
      if (_this.options.ignorePermissionErrors && (!_this._hasReadPermissions(stats))) {
        return;
      }
      if (_this._isIgnored.length === 2 && _this._isIgnored(item, stats)) {
        return;
      }
      if (stats.isFile()) {
        _this._handleFile(item, stats, initialAdd);
      }
      if (stats.isDirectory()) {
        return _this._handleDir(item, stats, initialAdd);
      }
    });
  });
};

FSWatcher.prototype.emit = function() {
  var args, event;
  event = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
  EventEmitter.prototype.emit.apply(this, [event].concat(__slice.call(args)));
  if (event === 'add' || event === 'addDir' || event === 'change' || event === 'unlink' || event === 'unlinkDir') {
    return EventEmitter.prototype.emit.apply(this, ['all', event].concat(__slice.call(args)));
  }
};

FSWatcher.prototype._addToFsEvents = function(files) {
  var handle,
    _this = this;
  handle = function(path) {
    return _this.emit('add', path);
  };
  files.forEach(function(file) {
    if (!_this.options.ignoreInitial) {
      fs.stat(file, function(error, stats) {
        if (error != null) {
          return _this.emit('error', error);
        }
        if (stats.isDirectory()) {
          return recursiveReaddir(file, function(error, dirFiles) {
            if (error != null) {
              return _this.emit('error', error);
            }
            return dirFiles.filter(function(path) {
              return !_this._isIgnored(path);
            }).forEach(handle);
          });
        } else {
          return handle(file);
        }
      });
    }
    return _this._watchWithFsEvents(file);
  });
  return this;
};

// Public: Adds directories / files for tracking.

// * files - array of strings (file paths).

// Examples

//   add ['app', 'vendor']

// Returns an instance of FSWatcher for chaning.
FSWatcher.prototype.add = function(files) {
  var _this = this;
  if (this._initialAdd == null) this._initialAdd = true;
  if (!Array.isArray(files)) files = [files];

  if (this.options.useFsEvents) return this._addToFsEvents(files);

  files.forEach(function(file) {
    return _this._handle(file, _this._initialAdd);
  });
  this._initialAdd = false;
  return this;
};

// Public: Remove all listeners from watched files.
// Returns an instance of FSWatcher for chaning.
FSWatcher.prototype.close = function() {
  var _this = this;
  this.watchers.forEach(function(watcher) {
    if (_this.options.useFsEvents) {
      return watcher.stop();
    } else {
      return watcher.close();
    }
  });
  if (this.options.usePolling) {
    Object.keys(this.watched).forEach(function(directory) {
      return _this.watched[directory].forEach(function(file) {
        return fs.unwatchFile(sysPath.join(directory, file));
      });
    });
  }
  this.watched = Object.create(null);
  this.removeAllListeners();
  return this;
};

exports.FSWatcher = FSWatcher;

exports.watch = function(files, options) {
  return new FSWatcher(options).add(files);
};

},{"events":3,"fs":false,"os":4,"path":false,"recursive-readdir":2}],2:[function(require,module,exports){
var fs = require('fs')

// how to know when you are done?
function readdir(path, callback) {
  var list = []

  fs.readdir(path, function (err, files) {
    if (err) {
      return callback(err)
    }

    var pending = files.length
    if (!pending) {
      // we are done, woop woop
      return callback(null, list)
    }

    files.forEach(function (file) {
      fs.stat(path + '/' + file, function (err, stats) {
        if (err) {
          return callback(err)
        }

        if (stats.isDirectory()) {
          files = readdir(path + '/' + file, function (err, res) {
            list = list.concat(res)
            pending -= 1
            if (!pending) {
              callback(null, list)
            }
          })
        }
        else {
          list.push(path + '/' + file)
          pending -= 1
          if (!pending) {
            callback(null, list)
          }
        }
      })
    })
  })
}

module.exports = readdir

},{"fs":false}],3:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      } else {
        throw TypeError('Uncaught, unspecified "error" event.');
      }
      return false;
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      console.trace();
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],4:[function(require,module,exports){
exports.endianness = function () { return 'LE' };

exports.hostname = function () {
    if (typeof location !== 'undefined') {
        return location.hostname
    }
    else return '';
};

exports.loadavg = function () { return [] };

exports.uptime = function () { return 0 };

exports.freemem = function () {
    return Number.MAX_VALUE;
};

exports.totalmem = function () {
    return Number.MAX_VALUE;
};

exports.cpus = function () { return [] };

exports.type = function () { return 'Browser' };

exports.release = function () {
    if (typeof navigator !== 'undefined') {
        return navigator.appVersion;
    }
    return '';
};

exports.networkInterfaces
= exports.getNetworkInterfaces
= function () { return {} };

exports.arch = function () { return 'javascript' };

exports.platform = function () { return 'browser' };

exports.tmpdir = exports.tmpDir = function () {
    return '/tmp';
};

exports.EOL = '\n';

},{}],5:[function(require,module,exports){
module.exports = function (args, opts) {
    if (!opts) opts = {};
    
    var flags = { bools : {}, strings : {} };
    
    [].concat(opts['boolean']).filter(Boolean).forEach(function (key) {
        flags.bools[key] = true;
    });
    
    [].concat(opts.string).filter(Boolean).forEach(function (key) {
        flags.strings[key] = true;
    });
    
    var aliases = {};
    Object.keys(opts.alias || {}).forEach(function (key) {
        aliases[key] = [].concat(opts.alias[key]);
        aliases[key].forEach(function (x) {
            aliases[x] = [key].concat(aliases[key].filter(function (y) {
                return x !== y;
            }));
        });
    });
    
    var defaults = opts['default'] || {};
    
    var argv = { _ : [] };
    Object.keys(flags.bools).forEach(function (key) {
        setArg(key, defaults[key] === undefined ? false : defaults[key]);
    });
    
    var notFlags = [];

    if (args.indexOf('--') !== -1) {
        notFlags = args.slice(args.indexOf('--')+1);
        args = args.slice(0, args.indexOf('--'));
    }

    function setArg (key, val) {
        var value = !flags.strings[key] && isNumber(val)
            ? Number(val) : val
        ;
        setKey(argv, key.split('.'), value);
        
        (aliases[key] || []).forEach(function (x) {
            setKey(argv, x.split('.'), value);
        });
    }
    
    for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        
        if (/^--.+=/.test(arg)) {
            // Using [\s\S] instead of . because js doesn't support the
            // 'dotall' regex modifier. See:
            // http://stackoverflow.com/a/1068308/13216
            var m = arg.match(/^--([^=]+)=([\s\S]*)$/);
            setArg(m[1], m[2]);
        }
        else if (/^--no-.+/.test(arg)) {
            var key = arg.match(/^--no-(.+)/)[1];
            setArg(key, false);
        }
        else if (/^--.+/.test(arg)) {
            var key = arg.match(/^--(.+)/)[1];
            var next = args[i + 1];
            if (next !== undefined && !/^-/.test(next)
            && !flags.bools[key]
            && (aliases[key] ? !flags.bools[aliases[key]] : true)) {
                setArg(key, next);
                i++;
            }
            else if (/^(true|false)$/.test(next)) {
                setArg(key, next === 'true');
                i++;
            }
            else {
                setArg(key, flags.strings[key] ? '' : true);
            }
        }
        else if (/^-[^-]+/.test(arg)) {
            var letters = arg.slice(1,-1).split('');
            
            var broken = false;
            for (var j = 0; j < letters.length; j++) {
                var next = arg.slice(j+2);
                
                if (next === '-') {
                    setArg(letters[j], next)
                    continue;
                }
                
                if (/[A-Za-z]/.test(letters[j])
                && /-?\d+(\.\d*)?(e-?\d+)?$/.test(next)) {
                    setArg(letters[j], next);
                    broken = true;
                    break;
                }
                
                if (letters[j+1] && letters[j+1].match(/\W/)) {
                    setArg(letters[j], arg.slice(j+2));
                    broken = true;
                    break;
                }
                else {
                    setArg(letters[j], flags.strings[letters[j]] ? '' : true);
                }
            }
            
            var key = arg.slice(-1)[0];
            if (!broken && key !== '-') {
                if (args[i+1] && !/^(-|--)[^-]/.test(args[i+1])
                && !flags.bools[key]
                && (aliases[key] ? !flags.bools[aliases[key]] : true)) {
                    setArg(key, args[i+1]);
                    i++;
                }
                else if (args[i+1] && /true|false/.test(args[i+1])) {
                    setArg(key, args[i+1] === 'true');
                    i++;
                }
                else {
                    setArg(key, flags.strings[key] ? '' : true);
                }
            }
        }
        else {
            argv._.push(
                flags.strings['_'] || !isNumber(arg) ? arg : Number(arg)
            );
        }
    }
    
    Object.keys(defaults).forEach(function (key) {
        if (!hasKey(argv, key.split('.'))) {
            setKey(argv, key.split('.'), defaults[key]);
            
            (aliases[key] || []).forEach(function (x) {
                setKey(argv, x.split('.'), defaults[key]);
            });
        }
    });
    
    notFlags.forEach(function(key) {
        argv._.push(key);
    });

    return argv;
};

function hasKey (obj, keys) {
    var o = obj;
    keys.slice(0,-1).forEach(function (key) {
        o = (o[key] || {});
    });

    var key = keys[keys.length - 1];
    return key in o;
}

function setKey (obj, keys, value) {
    var o = obj;
    keys.slice(0,-1).forEach(function (key) {
        if (o[key] === undefined) o[key] = {};
        o = o[key];
    });
    
    var key = keys[keys.length - 1];
    if (o[key] === undefined || typeof o[key] === 'boolean') {
        o[key] = value;
    }
    else if (Array.isArray(o[key])) {
        o[key].push(value);
    }
    else {
        o[key] = [ o[key], value ];
    }
}

function isNumber (x) {
    if (typeof x === 'number') return true;
    if (/^0x[0-9a-f]+$/i.test(x)) return true;
    return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(e[-+]?\d+)?$/.test(x);
}

function longest (xs) {
    return Math.max.apply(null, xs.map(function (x) { return x.length }));
}

},{}],6:[function(require,module,exports){
/* toSource by Marcello Bastea-Forte - zlib license */
module.exports = function(object, filter, indent, startingIndent) {
    var seen = []
    return walk(object, filter, indent === undefined ? '  ' : (indent || ''), startingIndent || '')

    function walk(object, filter, indent, currentIndent) {
        var nextIndent = currentIndent + indent
        object = filter ? filter(object) : object
        switch (typeof object) {
            case 'string':
                return JSON.stringify(object)
            case 'boolean':
            case 'number':
            case 'function':
            case 'undefined':
                return ''+object
        }

        if (object === null) return 'null'
        if (object instanceof RegExp) return object.toString()
        if (object instanceof Date) return 'new Date('+object.getTime()+')'

        if (seen.indexOf(object) >= 0) return '{$circularReference:1}'
        seen.push(object)

        function join(elements) {
            return indent.slice(1) + elements.join(','+(indent&&'\n')+nextIndent) + (indent ? ' ' : '');
        }

        if (Array.isArray(object)) {
            return '[' + join(object.map(function(element){
                return walk(element, filter, indent, nextIndent)
            })) + ']'
        }
        var keys = Object.keys(object)
        return keys.length ? '{' + join(keys.map(function (key) {
            return (legalKey(key) ? key : JSON.stringify(key)) + ':' + walk(object[key], filter, indent, nextIndent)
        })) + '}' : '{}'
    }
}

var KEYWORD_REGEXP = /^(abstract|boolean|break|byte|case|catch|char|class|const|continue|debugger|default|delete|do|double|else|enum|export|extends|false|final|finally|float|for|function|goto|if|implements|import|in|instanceof|int|interface|long|native|new|null|package|private|protected|public|return|short|static|super|switch|synchronized|this|throw|throws|transient|true|try|typeof|undefined|var|void|volatile|while|with)$/

function legalKey(string) {
    return /^[a-z_$][0-9a-z_$]*$/gi.test(string) && !KEYWORD_REGEXP.test(string)
}
},{}],7:[function(require,module,exports){
var UebersichtServer, args, e, parseArgs, port, widgetPath, _ref, _ref1, _ref2, _ref3;

parseArgs = require('minimist');

UebersichtServer = require('./src/app.coffee');

try {
  args = parseArgs(process.argv.slice(2));
  widgetPath = (_ref = (_ref1 = args.d) != null ? _ref1 : args.dir) != null ? _ref : './widgets';
  port = (_ref2 = (_ref3 = args.p) != null ? _ref3 : args.port) != null ? _ref2 : 41416;
  UebersichtServer(Number(port), widgetPath);
} catch (_error) {
  e = _error;
  console.log(e);
  process.exit(1);
}


},{"./src/app.coffee":8,"minimist":5}],8:[function(require,module,exports){
var ChangesServer, WidgetCommandServer, WidgetDir, WidgetsServer, connect, path;

connect = require('connect');

path = require('path');

WidgetDir = require('./widget_directory.coffee');

WidgetsServer = require('./widgets_server.coffee');

WidgetCommandServer = require('./widget_command_server.coffee');

ChangesServer = require('./changes_server.coffee');

module.exports = function(port, widgetPath) {
  var server, widgetDir;
  widgetPath = path.resolve(__dirname, widgetPath);
  widgetDir = WidgetDir(widgetPath);
  server = connect().use(connect["static"](path.resolve(__dirname, './public'))).use(WidgetCommandServer(widgetDir)).use(WidgetsServer(widgetDir)).use(ChangesServer.middleware).use(connect["static"](widgetPath)).listen(port);
  widgetDir.onChange(ChangesServer.push);
  console.log('server started on port', port);
  return server;
};


},{"./changes_server.coffee":9,"./widget_command_server.coffee":17,"./widget_directory.coffee":18,"./widgets_server.coffee":22,"connect":false,"path":false}],9:[function(require,module,exports){
var clients, currentChanges, serialize, timer;

serialize = require('./serialize.coffee');

clients = [];

currentChanges = {};

timer = null;

exports.push = function(changes) {
  var id, val;
  clearTimeout(timer);
  for (id in changes) {
    val = changes[id];
    currentChanges[id] = val;
  }
  return timer = setTimeout(function() {
    var client, json, _i, _len;
    if (clients.length > 0) {
      console.log('pushing changes');
      json = serialize(currentChanges);
      for (_i = 0, _len = clients.length; _i < _len; _i++) {
        client = clients[_i];
        client.response.end(json);
      }
      clients.length = 0;
    }
    return currentChanges = {};
  }, 50);
};

exports.middleware = function(req, res, next) {
  var client, parts;
  parts = req.url.replace(/^\//, '').split('/');
  if (!(parts.length === 1 && parts[0] === 'widget-changes')) {
    return next();
  }
  client = {
    request: req,
    response: res
  };
  clients.push(client);
  return setTimeout(function() {
    var index;
    index = clients.indexOf(client);
    if (!(index > -1)) {
      return;
    }
    clients.splice(index, 1);
    return client.response.end('');
  }, 25000);
};


},{"./serialize.coffee":14}],10:[function(require,module,exports){
module.exports = function(event, domEl) {
  var api, currentFrame, end, endHandler, prevPosition, update, updateHandler;
  api = {};
  updateHandler = function() {};
  endHandler = function() {};
  prevPosition = {
    x: event.pageX,
    y: event.pageY
  };
  currentFrame = domEl.getBoundingClientRect();
  update = function(e) {
    var dx, dy, _ref;
    _ref = [e.pageX - prevPosition.x, e.pageY - prevPosition.y], dx = _ref[0], dy = _ref[1];
    prevPosition = {
      x: e.pageX,
      y: e.pageY
    };
    return updateHandler(dx, dy);
  };
  end = function(e) {
    update(e);
    document.removeEventListener('mousemove', update);
    document.removeEventListener('mouseup', end);
    return endHandler();
  };
  document.addEventListener('mousemove', update);
  document.addEventListener('mouseup', end);
  api.update = function(handler) {
    return updateHandler = handler;
  };
  api.end = function(handler) {
    return endHandler = handler;
  };
  return api;
};


},{}],11:[function(require,module,exports){
module.exports = function(context) {
  var api;
  api = {};
  api.fillFrame = function(frame) {
    return context.fillRect(frame.left, frame.top, frame.width, frame.height);
  };
  api.strokeFrame = function(frame) {
    return context.strokeRect(frame.left, frame.top, frame.width, frame.height);
  };
  api.clearFrame = function(frame) {
    return context.clearRect(frame.left, frame.top, frame.width, frame.height);
  };
  return api;
};


},{}],12:[function(require,module,exports){
module.exports = function(canvas, width) {
  var api, calcDimensions, clear, clearFrame, context, fillFrame, strokeFrame;
  api = {};
  context = canvas.getContext("2d");
  api.render = function(prevFrame, frame, edge) {
    var dim;
    if (prevFrame != null) {
      clear(prevFrame, edge);
    }
    dim = calcDimensions(frame, edge);
    context.save();
    context.translate(dim.center.x, dim.center.y);
    context.rotate(dim.angle);
    context.beginPath();
    context.moveTo(dim.start + 5, 0);
    context.lineTo(dim.end, 0);
    if (typeof context.setLineDash === "function") {
      context.setLineDash([5, 2]);
    }
    context.strokeStyle = "#289ed6";
    context.lineWidth = width;
    context.stroke();
    return context.restore();
  };
  api.clear = clear = function(frame, edge) {
    var dim, oldGuideRect, rectHeight;
    dim = calcDimensions(frame, edge);
    rectHeight = 20;
    oldGuideRect = {
      left: dim.start,
      top: -rectHeight / 2,
      width: dim.end,
      height: rectHeight
    };
    context.save();
    context.translate(dim.center.x, dim.center.y);
    context.rotate(dim.angle);
    clearFrame(oldGuideRect);
    return context.restore();
  };
  calcDimensions = function(frame, edge) {
    var angle, center, end, start;
    center = {
      x: frame.left + frame.width / 2,
      y: frame.top + frame.height / 2
    };
    switch (edge) {
      case 'right':
        angle = 0;
        start = frame.width / 2;
        end = canvas.width;
        break;
      case 'bottom':
        angle = Math.PI / 2;
        start = frame.height / 2;
        end = canvas.height;
        break;
      case 'left':
        angle = Math.PI;
        start = frame.width / 2;
        end = canvas.width;
        break;
      case 'top':
        angle = -Math.PI / 2;
        start = frame.height / 2;
        end = canvas.height;
    }
    return {
      angle: angle,
      start: start,
      end: end,
      center: center
    };
  };
  fillFrame = function(frame) {
    return context.fillRect(frame.left, frame.top, frame.width, frame.height);
  };
  strokeFrame = function(frame) {
    return context.strokeRect(frame.left, frame.top, frame.width, frame.height);
  };
  clearFrame = function(frame) {
    return context.clearRect(frame.left, frame.top, frame.width, frame.height);
  };
  return api;
};


},{}],13:[function(require,module,exports){
exports.outset = function(rect, delta) {
  return {
    top: rect.top - delta,
    left: rect.left - delta,
    width: rect.width + 2 * delta,
    height: rect.height + 2 * delta
  };
};

exports.pointInRect = function(point, rect) {
  return point.left >= rect.left && point.top >= rect.top && point.left <= rect.left + rect.width && point.top <= rect.top + rect.height;
};

exports.clone = function(rect) {
  var clone, k, v;
  clone = {};
  for (k in rect) {
    v = rect[k];
    clone[k] = v;
  }
  return clone;
};


},{}],14:[function(require,module,exports){
module.exports = function(someWidgets) {
  var id, serialized, widget;
  serialized = "({";
  for (id in someWidgets) {
    widget = someWidgets[id];
    if (widget === 'deleted') {
      serialized += "'" + id + "': 'deleted',";
    } else {
      serialized += "'" + id + "': " + (widget.serialize()) + ",";
    }
  }
  return serialized.replace(/,$/, '') + '})';
};


},{}],15:[function(require,module,exports){
var exec, nib, stylus, toSource;

exec = require('child_process').exec;

toSource = require('tosource');

stylus = require('stylus');

nib = require('nib');

module.exports = function(implementation) {
  var api, contentEl, defaultStyle, el, init, parseStyle, redraw, refresh, render, renderOutput, rendered, started, timer, update, validate;
  api = {};
  el = null;
  contentEl = null;
  timer = null;
  update = null;
  render = null;
  started = false;
  rendered = false;
  defaultStyle = 'top: 30px; left: 10px';
  init = function() {
    var issues, _ref, _ref1, _ref2, _ref3;
    if ((issues = validate(implementation)).length !== 0) {
      throw new Error(issues.join(', '));
    }
    api.id = (_ref = implementation.id) != null ? _ref : 'widget';
    api.refreshFrequency = (_ref1 = implementation.refreshFrequency) != null ? _ref1 : 1000;
    if (!((implementation.css != null) || (typeof window !== "undefined" && window !== null))) {
      implementation.css = parseStyle((_ref2 = implementation.style) != null ? _ref2 : defaultStyle);
      delete implementation.style;
    }
    render = (_ref3 = implementation.render) != null ? _ref3 : function(output) {
      return output;
    };
    update = implementation.update;
    return api;
  };
  api.create = function() {
    el = document.createElement('div');
    contentEl = document.createElement('div');
    contentEl.id = api.id;
    contentEl.className = 'widget';
    el.innerHTML = "<style>" + implementation.css + "</style>\n";
    el.appendChild(contentEl);
    return el;
  };
  api.destroy = function() {
    var _ref;
    api.stop();
    if (el == null) {
      return;
    }
    if ((_ref = el.parentNode) != null) {
      _ref.removeChild(el);
    }
    el = null;
    return contentEl = null;
  };
  api.start = function() {
    started = true;
    if (timer != null) {
      clearTimeout(timer);
    }
    return refresh();
  };
  api.stop = function() {
    started = false;
    rendered = false;
    if (timer != null) {
      return clearTimeout(timer);
    }
  };
  api.exec = function(options, callback) {
    return exec(implementation.command, options, callback);
  };
  api.serialize = function() {
    return toSource(implementation);
  };
  api.setFrame = function(frame) {
    if (frame.top != null) {
      contentEl.style.top = frame.top;
    }
    if (frame.right != null) {
      contentEl.style.right = frame.right;
    }
    if (frame.bottom != null) {
      contentEl.style.bottom = frame.bottom;
    }
    if (frame.left != null) {
      contentEl.style.left = frame.left;
    }
    if (frame.width != null) {
      contentEl.style.width = frame.width;
    }
    if (frame.height != null) {
      contentEl.style.height = frame.height;
    }
    return contentEl.style.margin = 0;
  };
  api.contentEl = function() {
    return contentEl;
  };
  redraw = function(output, error) {
    var e;
    if (error) {
      contentEl.innerHTML = error;
      return rendered = false;
    }
    try {
      return renderOutput(output);
    } catch (_error) {
      e = _error;
      return contentEl.innerHTML = e.message;
    }
  };
  renderOutput = function(output) {
    if ((update != null) && rendered) {
      return update.call(implementation, output, contentEl);
    } else {
      contentEl.innerHTML = render.call(implementation, output);
      rendered = true;
      if (update != null) {
        return update.call(implementation, output, contentEl);
      }
    }
  };
  refresh = function() {
    return $.get('/widgets/' + api.id).done(function(response) {
      if (started) {
        return redraw(response);
      }
    }).fail(function(response) {
      if (started) {
        return redraw(null, response.responseText);
      }
    }).always(function() {
      if (!started) {
        return;
      }
      return timer = setTimeout(refresh, api.refreshFrequency);
    });
  };
  parseStyle = function(style) {
    var e, scopedStyle;
    if (!style) {
      return "";
    }
    scopedStyle = ("#" + api.id + "\n  ") + style.replace(/\n/g, "\n  ");
    try {
      return stylus(scopedStyle)["import"]('nib').use(nib()).render();
    } catch (_error) {
      e = _error;
      console.log('error parsing widget style:\n');
      console.log(e.message);
      console.log(scopedStyle);
      return "";
    }
  };
  validate = function(impl) {
    var issues;
    issues = [];
    if (impl == null) {
      return ['empty implementation'];
    }
    if (impl.command == null) {
      issues.push('no command given');
    }
    return issues;
  };
  return init();
};


},{"child_process":false,"nib":false,"stylus":false,"tosource":6}],16:[function(require,module,exports){
var EdgeGuide, Rect;

Rect = require('./rectangle_math.coffee');

EdgeGuide = require('./edge_guide.coffee');

module.exports = function(canvas, actions) {
  var api, chromeEl, clearFrame, context, cutoutToggles, draw, guide, init, prevFrame, renderGuides;
  api = {};
  context = canvas.getContext('2d');
  draw = require('./draw.coffee')(context);
  prevFrame = null;
  guide = EdgeGuide(canvas, 1);
  chromeEl = document.createElement('div');
  chromeEl.className = 'widget-chrome';
  chromeEl.innerHTML = "<div class='sticky-edge top'></div>\n<div class='sticky-edge right'></div>\n<div class='sticky-edge bottom'></div>\n<div class='sticky-edge left'></div>";
  chromeEl.style.position = 'absolute';
  init = function() {
    chromeEl.addEventListener('click', function(e) {
      var className, _i, _len, _ref, _results;
      if (!e.target.classList.contains('sticky-edge')) {
        return true;
      }
      e.stopPropagation();
      _ref = e.target.classList;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        className = _ref[_i];
        if (className === 'sticky-edge') {
          continue;
        }
        _results.push(actions.clickedStickyEdgeToggle(className));
      }
      return _results;
    });
    api.hide();
    return api;
  };
  api.render = function(widgetPosition) {
    var edges, el, frame, newFrame, _i, _len, _ref;
    chromeEl.style.display = 'block';
    clearFrame(prevFrame);
    if (widgetPosition == null) {
      return;
    }
    newFrame = widgetPosition.frame();
    frame = Rect.outset(newFrame, 1.5);
    context.strokeStyle = "#fff";
    context.lineWidth = 1;
    draw.strokeFrame(frame);
    cutoutToggles(frame, 20);
    frame = Rect.outset(newFrame, 2);
    chromeEl.style.left = frame.left + 'px';
    chromeEl.style.top = frame.top + 'px';
    chromeEl.style.width = frame.width + 'px';
    chromeEl.style.height = frame.height + 'px';
    edges = widgetPosition.stickyEdges();
    _ref = chromeEl.getElementsByClassName("sticky-edge");
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      el = _ref[_i];
      if (el.classList.contains(edges[0]) || el.classList.contains(edges[1])) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
    renderGuides(widgetPosition);
    return prevFrame = Rect.clone(newFrame);
  };
  renderGuides = function(widgetPosition) {
    var edge, edges, _i, _len, _results;
    edges = widgetPosition.stickyEdges();
    _results = [];
    for (_i = 0, _len = edges.length; _i < _len; _i++) {
      edge = edges[_i];
      _results.push(guide.render(prevFrame, widgetPosition.frame(), edge));
    }
    return _results;
  };
  api.clearGuides = function() {
    var edge, _i, _len, _ref, _results;
    if (prevFrame == null) {
      return;
    }
    _ref = ['top', 'right', 'bottom', 'left'];
    _results = [];
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      edge = _ref[_i];
      _results.push(guide.render(prevFrame, {}, edge));
    }
    return _results;
  };
  cutoutToggles = function(frame, toggleSize) {
    context.clearRect(frame.left + frame.width / 2 - toggleSize / 2, frame.top - toggleSize / 2, toggleSize, toggleSize);
    context.clearRect(frame.left + frame.width / 2 - toggleSize / 2, frame.top + frame.height - toggleSize / 2, toggleSize, toggleSize);
    context.clearRect(frame.left - toggleSize / 2, frame.top + frame.height / 2 - toggleSize / 2, toggleSize, toggleSize);
    return context.clearRect(frame.left + frame.width - toggleSize / 2, frame.top + frame.height / 2 - toggleSize / 2, toggleSize, toggleSize);
  };
  api.domEl = function() {
    return chromeEl;
  };
  api.hide = function() {
    clearFrame(prevFrame);
    api.clearGuides();
    chromeEl.style.display = 'none';
    return prevFrame = null;
  };
  clearFrame = function(frame) {
    if (frame != null) {
      return draw.clearFrame(Rect.outset(frame, 5));
    }
  };
  return init();
};


},{"./draw.coffee":11,"./edge_guide.coffee":12,"./rectangle_math.coffee":13}],17:[function(require,module,exports){
module.exports = function(widgetDir) {
  return function(req, res, next) {
    var parts, widget;
    parts = req.url.replace(/^\//, '').split('/');
    if (parts[0] === 'widgets') {
      widget = widgetDir.get(parts[1]);
    }
    if (widget == null) {
      return next();
    }
    return widget.exec({
      cwd: widgetDir.path
    }, function(err, data, stderr) {
      if (err || stderr) {
        res.writeHead(500);
        return res.end(stderr || err.message);
      } else {
        res.writeHead(200);
        return res.end(data);
      }
    });
  };
};


},{}],18:[function(require,module,exports){
var Widget, loader, paths;

Widget = require('./widget.coffee');

loader = require('./widget_loader.coffee');

paths = require('path');

module.exports = function(directoryPath) {
  var api, changeCallback, deleteWidget, init, isWidgetPath, loadWidget, notifyChange, registerWidget, watcher, widgetId, widgets;
  api = {};
  widgets = {};
  watcher = require('chokidar').watch(directoryPath);
  changeCallback = function() {};
  init = function() {
    watcher.on('change', function(filePath) {
      if (isWidgetPath(filePath)) {
        return registerWidget(loadWidget(filePath));
      }
    }).on('add', function(filePath) {
      if (isWidgetPath(filePath)) {
        return registerWidget(loadWidget(filePath));
      }
    }).on('unlink', function(filePath) {
      if (isWidgetPath(filePath)) {
        return deleteWidget(widgetId(filePath));
      }
    });
    console.log('watching', directoryPath);
    return api;
  };
  api.widgets = function() {
    return widgets;
  };
  api.get = function(id) {
    return widgets[id];
  };
  api.onChange = function(callback) {
    return changeCallback = callback;
  };
  api.path = directoryPath;
  loadWidget = function(filePath) {
    var definition, e, id;
    id = widgetId(filePath);
    definition = loader.loadWidget(filePath);
    if (definition != null) {
      definition.id = id;
    }
    try {
      return Widget(definition);
    } catch (_error) {
      e = _error;
      return console.log('error in widget', id + ':', e.message);
    }
  };
  registerWidget = function(widget) {
    if (widget == null) {
      return;
    }
    console.log('registering widget', widget.id);
    widgets[widget.id] = widget;
    return notifyChange(widget.id, widget);
  };
  deleteWidget = function(id) {
    if (widgets[id] == null) {
      return;
    }
    console.log('deleting widget', id);
    delete widgets[id];
    return notifyChange(id, 'deleted');
  };
  notifyChange = function(id, change) {
    var changes;
    changes = {};
    changes[id] = change;
    return changeCallback(changes);
  };
  widgetId = function(filePath) {
    var fileParts, part;
    fileParts = filePath.replace(directoryPath, '').split(/\/+/);
    fileParts = (function() {
      var _i, _len, _results;
      _results = [];
      for (_i = 0, _len = fileParts.length; _i < _len; _i++) {
        part = fileParts[_i];
        if (part) {
          _results.push(part);
        }
      }
      return _results;
    })();
    return fileParts.join('-').replace(/\./g, '-');
  };
  isWidgetPath = function(filePath) {
    var _ref;
    return (_ref = filePath.match(/\.coffee$/)) != null ? _ref : filePath.match(/\.js$/);
  };
  return init();
};


},{"./widget.coffee":15,"./widget_loader.coffee":19,"chokidar":1,"path":false}],19:[function(require,module,exports){
var coffee, fs, loadWidget;

fs = require('fs');

coffee = require('coffee-script');

exports.loadWidget = loadWidget = function(filePath) {
  var definition, e;
  definition = null;
  try {
    definition = fs.readFileSync(filePath, {
      encoding: 'utf8'
    });
    if (filePath.match(/\.coffee$/)) {
      definition = coffee["eval"](definition);
    } else {
      definition = eval('({' + definition + '})');
    }
    definition;
  } catch (_error) {
    e = _error;
    console.log("error loading widget " + filePath + ":\n" + e.message + "\n");
  }
  return definition;
};


},{"coffee-script":false,"fs":false}],20:[function(require,module,exports){
var EDGES;

EDGES = ['left', 'right', 'top', 'bottom'];

module.exports = function(widget) {
  var api, cssForFrame, currentFrame, getFrameFromDOM, getFrameFromStorage, getLocalSettings, getStickyEdges, init, slice, stickyEdges, storeLocalSettings;
  api = {};
  currentFrame = null;
  stickyEdges = [];
  init = function() {
    currentFrame = getFrameFromDOM();
    stickyEdges = getStickyEdges();
    return api;
  };
  api.domEl = function() {
    return widget.contentEl();
  };
  api.render = function() {
    if (currentFrame == null) {
      return;
    }
    return widget.setFrame(cssForFrame(currentFrame));
  };
  api.frame = function() {
    return currentFrame;
  };
  api.restoreFrame = function() {
    var frame;
    frame = getFrameFromStorage();
    if (frame != null) {
      return widget.setFrame(cssForFrame(frame));
    }
  };
  api.update = function(dx, dy) {
    if (currentFrame == null) {
      return;
    }
    currentFrame.top += dy;
    currentFrame.bottom -= dy;
    currentFrame.left += dx;
    return currentFrame.right -= dx;
  };
  api.store = function() {
    var settings;
    settings = getLocalSettings();
    settings.frame = currentFrame;
    settings.stickyEdges = stickyEdges;
    return storeLocalSettings(settings);
  };
  api.stickyEdges = function() {
    return stickyEdges;
  };
  api.setStickyEdge = function(edge) {
    if (stickyEdges.indexOf(edge) > -1) {
      return;
    }
    switch (edge) {
      case 'left':
        stickyEdges.push('left');
        stickyEdges = stickyEdges.filter(function(edge) {
          return edge !== "right";
        });
        break;
      case 'right':
        stickyEdges.push('right');
        stickyEdges = stickyEdges.filter(function(edge) {
          return edge !== "left";
        });
        break;
      case 'top':
        stickyEdges.push('top');
        stickyEdges = stickyEdges.filter(function(edge) {
          return edge !== "bottom";
        });
        break;
      case 'bottom':
        stickyEdges.push('bottom');
        stickyEdges = stickyEdges.filter(function(edge) {
          return edge !== "top";
        });
    }
    return stickyEdges;
  };
  cssForFrame = function(frame) {
    var attr, _i, _len, _ref;
    frame = slice(frame, stickyEdges.concat(['width', 'height']));
    _ref = EDGES.concat(['width', 'height']);
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      attr = _ref[_i];
      frame[attr] = frame[attr] != null ? frame[attr] + 'px' : 'auto';
    }
    return frame;
  };
  getFrameFromDOM = function() {
    var frame;
    frame = widget.contentEl().getBoundingClientRect();
    return {
      top: frame.top,
      right: window.innerWidth - frame.right,
      bottom: window.innerHeight - frame.bottom,
      left: frame.left,
      width: frame.width || 'auto',
      height: frame.height || 'auto'
    };
  };
  getFrameFromStorage = function() {
    var settings;
    settings = getLocalSettings();
    if (settings != null) {
      return settings.frame;
    }
  };
  getStickyEdges = function() {
    var settings, _ref;
    settings = getLocalSettings();
    return (_ref = settings != null ? settings.stickyEdges : void 0) != null ? _ref : ['bottom', 'left'];
  };
  getLocalSettings = function() {
    return JSON.parse(localStorage.getItem(widget.id) || '{}');
  };
  storeLocalSettings = function(settings) {
    if (!(settings && (settings.frame != null))) {
      return;
    }
    return localStorage.setItem(widget.id, JSON.stringify(settings));
  };
  slice = function(object, keys) {
    var k, result, _i, _len;
    result = {};
    for (_i = 0, _len = keys.length; _i < _len; _i++) {
      k = keys[_i];
      result[k] = object[k];
    }
    return result;
  };
  return init();
};


},{}],21:[function(require,module,exports){
var DragHandler, Rect, WidgetPosition, cancelAnimFrame, requestAnimFrame;

DragHandler = require('./drag_handler.coffee');

Rect = require('./rectangle_math.coffee');

WidgetPosition = require('./widget_position.coffee');

requestAnimFrame = typeof webkitRequestAnimationFrame !== "undefined" && webkitRequestAnimationFrame !== null ? webkitRequestAnimationFrame : setTimeout;

cancelAnimFrame = typeof webkitCancelAnimationFrame !== "undefined" && webkitCancelAnimationFrame !== null ? webkitCancelAnimationFrame : clearTimeout;

module.exports = function(widgets) {
  var api, canvas, chrome, chromeEl, context, currentWidget, currentWidgetPosition, deselectWidget, getWidgetAt, guide, init, initCanvas, onMouseDown, renderDrag, selectWidget, setStickyEdge, startPositioning;
  api = {};
  canvas = null;
  context = null;
  chrome = null;
  currentWidget = null;
  currentWidgetPosition = null;
  chromeEl = null;
  guide = null;
  init = function() {
    document.addEventListener('mousedown', onMouseDown);
    canvas = document.createElement('canvas');
    context = canvas.getContext("2d");
    document.body.insertBefore(canvas, document.body.firstChild);
    initCanvas();
    chrome = require('./widget_chrome.coffee')(canvas, {
      clickedStickyEdgeToggle: setStickyEdge
    });
    document.body.appendChild(chrome.domEl());
    return api;
  };
  api.destroy = function() {
    document.removeEventListener('mousedown', onMouseDown);
    if (canvas.parentElement != null) {
      return document.body.removeChild(canvas);
    }
  };
  api.restorePosition = function(widget) {
    var widgetPosition;
    widgetPosition = WidgetPosition(widget);
    return widgetPosition.restoreFrame();
  };
  onMouseDown = function(e) {
    var widget;
    if (e.which !== 1) {
      return;
    }
    widget = getWidgetAt({
      left: e.clientX,
      top: e.clientY
    });
    if (widget != null) {
      selectWidget(widget);
      return startPositioning(currentWidgetPosition, e);
    } else {
      return deselectWidget();
    }
  };
  selectWidget = function(widget) {
    currentWidgetPosition = WidgetPosition(widget);
    currentWidget = widget;
    chrome.render(currentWidgetPosition);
    return currentWidgetPosition;
  };
  deselectWidget = function() {
    if (!currentWidget) {
      return;
    }
    chrome.hide();
    currentWidget = null;
    return currentWidgetPosition = null;
  };
  startPositioning = function(widgetPosition, e) {
    var handler, request;
    handler = DragHandler(e, widgetPosition.domEl());
    request = null;
    handler.update(function(dx, dy) {
      widgetPosition.update(dx, dy);
      return request = requestAnimFrame(renderDrag(widgetPosition));
    });
    return handler.end(function() {
      cancelAnimFrame(request);
      widgetPosition.store();
      return requestAnimFrame(function() {
        return chrome.clearGuides();
      });
    });
  };
  renderDrag = function(widgetPosition) {
    return function() {
      if (widgetPosition != null) {
        widgetPosition.render();
      }
      return chrome.render(widgetPosition);
    };
  };
  getWidgetAt = function(point) {
    var foundEl, widgetEl, _i, _len, _ref;
    foundEl = {};
    _ref = document.getElementsByClassName('widget');
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      widgetEl = _ref[_i];
      if (widgetEl.id == null) {
        continue;
      }
      if (Rect.pointInRect(point, widgetEl.getBoundingClientRect())) {
        foundEl = widgetEl;
        break;
      }
    }
    return widgets.get(foundEl.id);
  };
  initCanvas = function() {
    canvas.style.position = 'absolute';
    canvas.style.top = 0;
    canvas.style.left = 0;
    canvas.width = window.innerWidth;
    return canvas.height = window.innerHeight;
  };
  setStickyEdge = function(newStickyEdge) {
    var edge, _i, _len, _ref;
    if (currentWidgetPosition == null) {
      return;
    }
    _ref = currentWidgetPosition.stickyEdges();
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      edge = _ref[_i];
      guide.clear(currentWidgetPosition.frame(), edge);
    }
    currentWidgetPosition.setStickyEdge(newStickyEdge);
    chrome.render(currentWidgetPosition);
    return currentWidgetPosition.store();
  };
  return init();
};


},{"./drag_handler.coffee":10,"./rectangle_math.coffee":13,"./widget_chrome.coffee":16,"./widget_position.coffee":20}],22:[function(require,module,exports){
var serialize;

serialize = require('./serialize.coffee');

module.exports = function(widgetDir) {
  return function(req, res, next) {
    var parts;
    parts = req.url.replace(/^\//, '').split('/');
    if (!(parts.length === 1 && parts[0] === 'widgets')) {
      return next();
    }
    return res.end(serialize(widgetDir.widgets()));
  };
};


},{"./serialize.coffee":14}]},{},[7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22])
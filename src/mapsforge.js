var when = require('when');
var assert = require('assert');
var StringDecoder = require('string_decoder').StringDecoder;

function getArrayBuffer(url) {
  var deferred = when.defer();
  var oReq = new XMLHttpRequest();
  oReq.open("GET", url, true);
  oReq.responseType = "arraybuffer";

  oReq.onload = function (oEvent) {
    var arrayBuffer = oReq.response;
    if (arrayBuffer) {
      deferred.resolve(arrayBuffer);
    } else {
      deferred.reject();
    }
  };
  oReq.send(null);
  return deferred.promise;
}

// Chrome doesn't support TextDecoder on main thread.
// var textDecoder = new TextDecoder('utf-8');
var decoder = new StringDecoder('utf8');

var BufferReaders = {
  readString: function (data, len) {
    return decoder.write(new Buffer(data));
  },
  readShort: function (bytes) {
    var iShort = (bytes[0] << 8) + bytes[1];
    if (iShort > 32767)
      return iShort - 65536;
    else
      return iShort;
  },
  readInt: function (bytes) {
    var iInt = (((((bytes[0] << 8) + bytes[1]) << 8) + bytes[2]) << 8) + bytes[3];

    if (iInt > 2147483647)
      return iInt - 4294967296;
    else
      return iInt;
  },
  readLong: function (bytes) {
    if (bytes[0] !== 0 || bytes[1] !== 0 || bytes[2] !== 0 || bytes[3] !== 0) {
      throw new Error('Big longs arent supported.')
    }
    return (((((bytes[4] << 8) + bytes[5]) << 8) + bytes[6]) << 8) + bytes[7];
  },
  readUnsignedInt: function (buffer, data) {
    var pos = buffer.pos - 5;
    if ((data[0] & 0x80) == 0) {
    buffer.pos = pos + 1;
    return (data[0] & 0x7f);
    }

    if ((data[1] & 0x80) == 0) {
    buffer.pos = pos + 2;
    return (data[0] & 0x7f)
    | (data[1] & 0x7f) << 7;
    }

    if ((data[2] & 0x80) == 0) {
    buffer.pos = pos + 3;
    return (data[0] & 0x7f)
    | ((data[1] & 0x7f) << 7)
    | ((data[2] & 0x7f) << 14);
    }

    if ((data[3] & 0x80) == 0) {
    buffer.pos = pos + 4;
    return (data[0] & 0x7f)
    | ((data[1] & 0x7f) << 7)
    | ((data[2] & 0x7f) << 14)
    | ((data[3] & 0x7f) << 21);
    }

    buffer.pos = pos + 5;
    return (data[0] & 0x7f)
    | ((data[1] & 0x7f) << 7)
    | ((data[2] & 0x7f) << 14)
    | ((data[3] & 0x7f) << 21)
    | ((data[4] & 0x7f) << 28);
  }
};

var MercatorProjection = {
  getMapSize: function (zoomLevel) {
    assert(zoomLevel >= 0, "zoom level must not be negative: " + zoomLevel);
    return 256 << zoomLevel;
  },
  latitudeToPixelY: function (latitude, zoomLevel) {
    var sinLatitude = Math.sin(latitude * (Math.PI / 180));
    var mapSize = this.getMapSize(zoomLevel);
    // FIXME improve this formula so that it works correctly without the clipping
    var pixelY = (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * mapSize;
    return Math.min(Math.max(0, pixelY), mapSize);
  },
  latitudeToTileY: function (latitude, zoomLevel) {
    return this.pixelYToTileY(this.latitudeToPixelY(latitude, zoomLevel), zoomLevel);
  },
  longitudeToPixelX: function (longitude, zoomLevel) {
    var mapSize = this.getMapSize(zoomLevel);
    return (longitude + 180) / 360 * mapSize;
  },
  longitudeToTileX: function (longitude, zoomLevel) {
    return this.pixelXToTileX(this.longitudeToPixelX(longitude, zoomLevel), zoomLevel);
  },
  pixelXToLongitude: function (pixelX, zoomLevel) {
    var mapSize = this.getMapSize(zoomLevel);
    assert(pixelX >= 0 && pixelX <= mapSize, "invalid pixelX coordinate at zoom level " + zoomLevel + ": " + pixelX);
    return 360 * ((pixelX / mapSize) - 0.5);
  },
  pixelXToTileX: function (pixelX, zoomLevel) {
    return Math.min(Math.max(pixelX / 256, 0), Math.pow(2, zoomLevel) - 1);
  },
  pixelYToLatitude: function (pixelY, zoomLevel) {
    var mapSize = this.getMapSize(zoomLevel);
    assert(pixelY >= 0 && pixelY <= mapSize, "invalid pixelY coordinate at zoom level " + zoomLevel + ": " + pixelY);
    var y = 0.5 - (pixelY / mapSize);
    return 90 - 360 * Math.atan(Math.exp(-y * (2 * Math.PI))) / Math.PI;
  },
  pixelYToTileY: function (pixelY, zoomLevel) {
    return Math.min(Math.max(pixelY / 256, 0), Math.pow(2, zoomLevel) - 1);
  },
  tileXToLongitude: function (tileX, zoomLevel) {
    return this.pixelXToLongitude(tileX * 256, zoomLevel);
  },
  tileYToLatitude: function (tileY, zoomLevel) {
    return this.pixelYToLatitude(tileY * 256, zoomLevel);
  }
};

// Hacky sync/async buffer.
function DualBuffer(data, sync) {
  this.data = data;
  this.pos = 0;
  this.sync = sync;
}
DualBuffer.prototype = {
  readSync: function (len) {
    var temp = this.pos;
    this.pos += len;
    return this.data.subarray(temp, this.pos);
  },
  read: function (len) {
    var temp = this.pos;
    this.pos += len;
    return when(this.data.subarray(temp, this.pos));
  },
  readString: function (len) {
    if (this.sync) {
      return BufferReaders.readString(this.readSync(len), len);
    }
    return this.read(len).then(function (data) {
      return BufferReaders.readString(data, len);
    });
  },
  readVariableString: function () {
    if (this.sync) {
      var len = this.readUnsignedInt()
      return this.readString(len);
    }
    assert(false, 'todo');
  },
  readByte: function () {
    if (this.sync) {
      return this.readSync(1)[0];
    }
    assert(false, 'todo');
  },
  readShort: function () {
    if (this.sync) {
      return BufferReaders.readShort(this.readSync(2));
    }
    return this.read(2).then(function (data) {
      return BufferReaders.readShort(data);
    });
  },
  readInt: function () {
    if (this.sync) {
      return BufferReaders.readInt(this.readSync(4));
    }
    return this.read(4).then(function (data) {
      return BufferReaders.readInt(data);
    });
  },
  readLong: function () {
    if (this.sync) {
      return BufferReaders.readLong(this.readSync(8));
    }
    return this.read(8).then(function (data) {
      return BufferReaders.readLong(data);
    });
  },
  readUnsignedInt: function () {
    if (this.sync) {
      return BufferReaders.readUnsignedInt(this, this.readSync(5));
    }
    return this.read(5).then(function (data) {
      return BufferReaders.readUnsignedInt(this, data);
    }.bind(this));
  }
};

function read(buffer) {
  var MAGIC_BYTE = 'mapsforge binary OSM';
  var CONVERSION_FACTOR = 1000000;
  var HEADER_BITMASK_COMMENT = 0x08;
  var HEADER_BITMASK_CREATED_BY = 0x04;
  var HEADER_BITMASK_DEBUG = 0x80;
  var HEADER_BITMASK_LANGUAGE_PREFERENCE = 0x10;
  var HEADER_BITMASK_START_POSITION = 0x40;
  var HEADER_BITMASK_START_ZOOM_LEVEL = 0x20;

  var headBuffer;

  function readMagicByte() {
    return buffer.readString(MAGIC_BYTE.length).then(function (str) {
      assert.equal(str, MAGIC_BYTE, 'Magic byte matches.');
      return true;
    });
  }

  function readHeaderSize() {
    return buffer.readInt();
  }

  function readFileVersion() {
    return headBuffer.readInt();
  }

  function readFileSize() {
    return headBuffer.readLong();
  }

  function readMapDate() {
    return headBuffer.read(8);
  }

  function readBoundingBox() {
    return {
      minLatitude: headBuffer.readInt() / CONVERSION_FACTOR,
      minLongitude: headBuffer.readInt() / CONVERSION_FACTOR,
      maxLatitude: headBuffer.readInt() / CONVERSION_FACTOR,
      maxLongitude: headBuffer.readInt() / CONVERSION_FACTOR
    };
  }

  function readTileSize() {
    return headBuffer.readShort();
  }

  function readProjection() {
    return headBuffer.readVariableString();
  }

  function readOptionalFields(mapInfo) {
    var flags = headBuffer.readSync(1)[0];
    // TODO some of these flags should go on the mapinfo.
    var isDebugFile = (flags & HEADER_BITMASK_DEBUG) != 0;
    var hasStartPosition = (flags & HEADER_BITMASK_START_POSITION) != 0;
    var hasStartZoomLevel = (flags & HEADER_BITMASK_START_ZOOM_LEVEL) != 0;
    var hasLanguagePreference = (flags & HEADER_BITMASK_LANGUAGE_PREFERENCE) != 0;
    var hasComment = (flags & HEADER_BITMASK_COMMENT) != 0;
    var hasCreatedBy = (flags & HEADER_BITMASK_CREATED_BY) != 0;

    mapInfo.debugFile = isDebugFile;

    if (hasStartPosition) {
      mapInfo.startPosition = [
        headBuffer.readInt() / CONVERSION_FACTOR,
        headBuffer.readInt() / CONVERSION_FACTOR
      ];
    }

    if (hasStartZoomLevel) {
      mapInfo.startZoomLevel = headBuffer.readSync(1)[0];
    }

    if (hasLanguagePreference) {
      mapInfo.languagePreference = headBuffer.readVariableString();
    }

    if (hasComment) {
      mapInfo.comment = headBuffer.readVariableString();
    }

    if (hasCreatedBy) {
      mapInfo.createdBy = headBuffer.readVariableString();
    }
  }

  function readTags() {
    var numberOfTags = headBuffer.readShort();
    var tags = [];
    for (var i = 0; i < numberOfTags; i++) {
      tags.push(headBuffer.readVariableString());
    }
    return tags;
  }

  function more(subFileParam, mapInfo) {
    // calculate the XY numbers of the boundary tiles in this sub-file
    subFileParam.boundaryTileBottom = MercatorProjection.latitudeToTileY(mapInfo.boundingBox.minLatitude,
        subFileParam.baseZoomLevel);
    subFileParam.boundaryTileLeft = MercatorProjection.longitudeToTileX(mapInfo.boundingBox.minLongitude,
        subFileParam.baseZoomLevel);
    subFileParam.boundaryTileTop = MercatorProjection.latitudeToTileY(mapInfo.boundingBox.maxLatitude,
        subFileParam.baseZoomLevel);
    subFileParam.boundaryTileRight = MercatorProjection.longitudeToTileX(mapInfo.boundingBox.maxLongitude,
        subFileParam.baseZoomLevel);

    // calculate the horizontal and vertical amount of blocks in this sub-file
    subFileParam.blocksWidth = subFileParam.boundaryTileRight - subFileParam.boundaryTileLeft + 1;
    subFileParam.blocksHeight = subFileParam.boundaryTileBottom - subFileParam.boundaryTileTop + 1;

    // calculate the total amount of blocks in this sub-file
    subFileParam.numberOfBlocks = subFileParam.blocksWidth * subFileParam.blocksHeight;

    subFileParam.indexEndAddress = subFileParam.indexStartAddress + subFileParam.numberOfBlocks * 5;
  }
  function readSubFileParameters(mapInfo) {
    var numberOfSubFiles = headBuffer.readSync(1)[0];
    var subFiles = [];
    var min = 21;
    var max = 0;
    for (var i = 0; i < numberOfSubFiles; i++) {
      var baseZoomLevel = headBuffer.readByte();
      var zoomLevelMin = headBuffer.readByte();
      var zoomLevelMax = headBuffer.readByte();
      var startAddress = headBuffer.readLong();
      // TODO: verify zoom level min/max
      if (zoomLevelMin < min) {
        min = zoomLevelMin;
      }
      if (zoomLevelMax > max) {
        max = zoomLevelMax;
      }
      var subFile = {
        baseZoomLevel: baseZoomLevel,
        zoomLevelMin: zoomLevelMin,
        zoomLevelMax: zoomLevelMax,
        startAddress: startAddress,
        indexStartAddress: mapInfo.debugFile ? startAddress + 16 : startAddress,
        subFileSize: headBuffer.readLong()
      };
      subFiles.push(subFile);
      more(subFile, mapInfo);
    }
    return {
      subFiles: subFiles,
      zoomLevelMin: min,
      zoomLevelMax: max
    };
  }

  function readMapData(mapInfo, tileX, tileY, zoomLevel) {
    function readSubFile(subFileParams) {
      buffer.pos = subFileParams.indexStartAddress;
      return buffer.read(subFileParams.subFileSize).then(function (bytes) {
        console.log(bytes);
      });
    }

    if (zoomLevel > mapInfo.subFiles.zoomLevelMax) {
      zoomLevel = mapInfo.subFiles.zoomLevelMax;
    } else if (zoomLevel < mapInfo.subFiles.zoomLevelMin) {
      zoomLevel = mapInfo.subFiles.zoomLevelMin;
    }
    var subFiles = mapInfo.subFiles.subFiles;
    var subFile = null;
    for (var i = 0; i < subFiles.length; i++) {
      if (zoomLevel >= subFiles[i].zoomLevelMin && zoomLevel <= subFiles[i].zoomLevelMax) {
        subFile = subFiles[i];
        break;
      }
    }
    if (!subFile) {
      throw new Error('Couldnt find subfile for zoom level');
    }
    console.log(subFile);

    return readSubFile(subFile);
  }

  var mapInfo = {
    boundingBox: null,
    comment: null,
    createdBy: null,
    debugFile: null,
    fileSize: null,
    fileVersion: null,
    languagePreference: null,
    mapDate: null,
    // numberOfSubFiles: null,
    poiTags: [],
    projectionName: null,
    startPosition: null,
    startZoomLevel: null,
    tilePixelSize: null,
    wayTags: null,
    readMapData: function (tileX, tileY, zoomLevel) {
      return readMapData(this, tileX, tileY, zoomLevel);
    }
  };

  return readMagicByte().then(readHeaderSize).then(function (headerSize) {
    return buffer.read(headerSize - 4);
  }).then(function (headerData) {
    headBuffer = new DualBuffer(headerData, true);
    mapInfo.fileVersion = readFileVersion();
    mapInfo.fileSize = readFileSize();
    readMapDate();
    mapInfo.boundingBox = readBoundingBox();
    mapInfo.tilePixelSize = readTileSize();
    mapInfo.projectionName = readProjection();
    readOptionalFields(mapInfo);
    mapInfo.poiTags = readTags();
    mapInfo.wayTags = readTags();
    mapInfo.subFiles = readSubFileParameters(mapInfo);
    return mapInfo;
  });
}

exports.read = function (url) {
  return getArrayBuffer(url).then(function (data) {
    var stream = new DualBuffer(new Uint8Array(data));
    return read(stream);
  });
};

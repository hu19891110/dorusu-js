'use strict';

var _ = require('lodash');
var app = require('./app.js')

var ProtoBuf = require('protobufjs');

/**
 * nurpc/protobuf allows the creation of clients defined by protobuf IDL and
 * support for servers host protobuf defined services.
 *
 * @module nurpc/protobuf
 */

/**
 * Get a function that unmarshals a specific type of protobuf.
 * @param {function()} pbClass The constructor of the message type to unmarshal
 * @return {function(Buffer):cls} The unmarshaller function
 */
var buildUnmarshalFunc = function buildUnmarshalFunc(cls) {
  /**
   * Unmarshals a `Buffer` to a message object
   * @param {external:Buffer} b The buffer to deserialize
   * @returns {Object} The resulting object
   */
  return function unmarshal(b) {
    // Convert to a native object with binary fields as Buffers (first argument)
    // and longs as strings (second argument)
    return cls.decode(b).toRaw(false, true);
  };
}

/**
 * Get a function that marshals objects to `Buffer` by protobuf class.
 * @param {function()} pbClass The constructor of the message type to marshal
 * @return {function(pbClass):Buffer} the marshaller function
 */
var buildMarshalFunc = function buildMarshalFunc(pbClass) {
  /**
   * Marshals an object into a `Buffer`
   * @param {Object} arg The object to marshal
   * @return {external:Buffer} The marshalled object
   */
  return function marshal(arg) {
    return new Buffer(new pbClass(arg).encode().toBuffer());
  };
}

/**
 * Determines the full dotted name of a Protobuf.Reflect value
 * @param {ProtoBuf.Reflect.Namespace} value The value to get the name of
 * @return {string} The fully qualified name of the value
 */
var fullyDotted = function fullyDotted(value) {
  if (!value) {
    return '';
  }
  var name;
  while (value) {
    var suffix = value.name;
    if (value.className === 'Service.RPCMethod') {
      suffix = _.capitalize(suffix);
    }
    if (!name) {
      name = suffix;
    } else if (suffix !== '') {
      name = suffix + '.' + name;
    }
    value = value.parent;
  }
  return name;
};

/**
 * Load a proto peer object from a file.
 *
 * @description format is either `proto` or `json`, defaulting to `proto`
 *
 * @param {string} path path of the file to load
 * @param {string} [format='proto'] the format of the file
 * @returns {Object<string, *>} a proto peer object
 */
exports.loadProto = function loadProto(path, format) {
  if (!format) {
    format = 'proto';
  }
  var builder;
  switch(format) {
    case 'proto':
    builder = ProtoBuf.loadProtoFile(path);
    break;
    case 'json':
    builder = ProtoBuf.loadJsonFile(path);
    break;
    default:
    throw new Error('Unrecognized format "' + format + '"');
  }

  return loadObject(builder.ns);
}

/**
 * Generates a peer object from ProtoBuf.Reflect object.
 *
 * The result is an object graph, containing peers for their equivalent
 * in the original Protobuf.Reflect graph.  Services are treated specially,
 * they are converted into an object
 * {
 *   client: <client_service_peer>
 *   server: <server_service_peer>
 * }
 *
 * where client_service_peer can be used to create rpc clients using
 * `client.buildClient` and server_service_peer can be used specify services in
 * server apps via `app.RpcApp#addService`
 *
 * @param {ProtoBuf.Reflect.Namespace} value the Protobuf object to load
 * @return {Object<string, *>} the peer object.
 */
exports.loadObject = function loadObject(value) {
  var result = {};
  if (value.className === 'Namespace') {
    _.each(value.children, function(child) {
      result[child.name] = loadObject(child);
    });
    return result;
  } else if (value.className === 'Service') {
    return {
      client: clientSideSvcFor(value),
      server: serverSideSvcFor(value)
    }
  } else if (value.className === 'Message' || value.className === 'Enum') {
    return value.build();
  } else {
    return value;
  }
};
var loadObject = exports.loadObject;

/**
 * Converts a ProtoBuf service to an app.Service used to build clients.
 *
 * @param {ProtoBuf.Reflect.Service} protoSvc A protobufjs service descriptor
 * @return {Service} the corresponding client-side app.Service
 */
var clientSideSvcFor = function clientSideSvcFor(protoSvc) {
  var convertMethod = function convertMethod(m) {
    return app.Method(
      _.capitalize(m.name),
      buildMarshalFunc(m.resolvedRequestType.build()),
      buildUnmarshalFunc(m.resolvedResponseType.build()),
      m.requestStream);
  };
  var methods = _.map(protoSvc.children, convertMethod);
  return new app.Service(fullyDotted(protoSvc), methods);
};

/**
 * Converts a ProtoBuf service to an app.Service for use in server rpc apps.
 *
 * @param {ProtoBuf.Reflect.Service} protoSvc A protobufjs service descriptor
 * @return {Service} the corresponding server-side app.Service
 */
var serverSideSvcFor = function serverSideSvcFor(protoSvc) {
  var convertMethod = function convertMethod(m) {
    return app.Method(
      _.capitalize(m.name),
      buildMarshalFunc(m.resolvedResponseType.build()),
      buildUnmarshalFunc(m.resolvedRequestType.build()),
      m.requestStream);
  };
  var methods = _.map(protoSvc.children, convertMethod);
  return new app.Service(fullyDotted(protoSvc), methods);
};

/**
 * The nodejs `Buffer` class .
 * @external Buffer
 * @see https://nodejs.org/api/buffer.html
 */
'use strict';

const BbPromise = require('bluebird');
const s3 = require('@auth0/s3');
const chalk = require('chalk');
const minimatch = require('minimatch');
const path = require('path');

const messagePrefix = 'S3 Sync: ';

class ServerlessS3Sync {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.servicePath = this.serverless.service.serverless.config.servicePath;

    this.commands = {
      s3sync: {
        usage: 'Sync directories and S3 prefixes',
        lifecycleEvents: [
          'sync'
        ]
      }
    };

    this.hooks = {
      'before:remove:remove': () => BbPromise.bind(this).then(this.clear),
      's3sync:sync': () => BbPromise.bind(this).then(this.sync)
    };
  }

  client() {
    const provider = this.serverless.getProvider('aws');
    const awsCredentials = provider.getCredentials();
    const s3Client = new provider.sdk.S3({
      region: awsCredentials.region,
      credentials: awsCredentials.credentials,
    });

    return s3.createClient({ s3Client });
  }

  sync() {
    const s3Sync = this.serverless.service.custom.s3Sync;
    const cli = this.serverless.cli;
    if (!Array.isArray(s3Sync)) {
      cli.consoleLog(`${messagePrefix}${chalk.red('No configuration found')}`)
      return Promise.resolve();
    }
    cli.consoleLog(`${messagePrefix}${chalk.yellow('Syncing directories and S3 prefixes...')}`);
    const servicePath = this.servicePath;
    const promises = s3Sync.map((s) => {
      let bucketPrefix = '';
      if (s.hasOwnProperty('bucketPrefix')) {
        bucketPrefix = s.bucketPrefix;
      }
      let acl = 'private';
      if (s.hasOwnProperty('acl')) {
        acl = s.acl;
      }
      let followSymlinks = false;
      if (s.hasOwnProperty('followSymlinks')) {
        followSymlinks = s.followSymlinks;
      }
      let defaultContentType = undefined
      if (s.hasOwnProperty('defaultContentType')) {
        defaultContentType = s.defaultContentType;
      }
      if (!s.bucketName || !s.localDir) {
        throw 'Invalid custom.s3Sync';
      }
      let deleteRemoved = true;
      if (s.hasOwnProperty('deleteRemoved')) {
          deleteRemoved = s.deleteRemoved;
      }

      return new Promise((resolve) => {
        const localDir = [servicePath, s.localDir].join('/');

        const params = {
          maxAsyncS3: 5,
          localDir,
          deleteRemoved,
          followSymlinks: followSymlinks,
          getS3Params: (localFile, stat, cb) => {
            const s3Params = {};
            let onlyForEnv;

            if(Array.isArray(s.params)) {
              s.params.forEach((param) => {
                const glob = Object.keys(param)[0];

                if(minimatch(localFile, `${path.resolve(localDir)}/${glob}`)) {
                  Object.assign(s3Params, param[glob] || {});
                  onlyForEnv = s3Params['OnlyForEnv'] || onlyForEnv;
                }
              });
              // to avoid parameter validation error
              delete s3Params['OnlyForEnv'];
            }

            if (onlyForEnv && onlyForEnv !== this.options.env) {
              cb(null, null);
            } else {
              cb(null, s3Params);
            }
          },
          s3Params: {
            Bucket: s.bucketName,
            Prefix: bucketPrefix,
            ACL: acl
          }
        };
        if (typeof(defaultContentType) != 'undefined') {
          Object.assign(params, {defaultContentType: defaultContentType})
        }
        const uploader = this.client().uploadDir(params);
        uploader.on('error', (err) => {
          throw err;
        });
        let percent = 0;
        uploader.on('progress', () => {
          if (uploader.progressTotal === 0) {
            return;
          }
          const current = Math.round((uploader.progressAmount / uploader.progressTotal) * 10) * 10;
          if (current > percent) {
            percent = current;
            cli.printDot();
          }
        });
        uploader.on('end', () => {
          resolve('done');
        });
      });
    });
    return Promise.all(promises)
      .then(() => {
        cli.printDot();
        cli.consoleLog('');
        cli.consoleLog(`${messagePrefix}${chalk.yellow('Synced.')}`);
      });
  }

  clear() {
    const s3Sync = this.serverless.service.custom.s3Sync;
    if (!Array.isArray(s3Sync)) {
      return Promise.resolve();
    }
    const cli = this.serverless.cli;
    cli.consoleLog(`${messagePrefix}${chalk.yellow('Removing S3 objects...')}`);
    const promises = s3Sync.map((s) => {
      let bucketPrefix = '';
      if (s.hasOwnProperty('bucketPrefix')) {
        bucketPrefix = s.bucketPrefix;
      }
      return new Promise((resolve) => {
        const params = {
          Bucket: s.bucketName,
          Prefix: bucketPrefix
        };
        const uploader = this.client().deleteDir(params);
        uploader.on('error', (err) => {
          throw err;
        });
        let percent = 0;
        uploader.on('progress', () => {
          if (uploader.progressTotal === 0) {
            return;
          }
          const current = Math.round((uploader.progressAmount / uploader.progressTotal) * 10) * 10;
          if (current > percent) {
            percent = current;
            cli.printDot();
          }
        });
        uploader.on('end', () => {
          resolve('done');
        });
      });
    });
    return Promise.all(promises)
      .then(() => {
        cli.printDot();
        cli.consoleLog('');
        cli.consoleLog(`${messagePrefix}${chalk.yellow('Removed.')}`);
      });
  }
}

module.exports = ServerlessS3Sync;

'use strict';

var ssh2 = require('ssh2'),
	child_process = require('child_process'),
	fs = require('fs'),
	lastMailHistory = [],
	historyDir = __dirname + '/tmp',
	sendmailjs;

/* istanbul ignore next */
if (!fs.existsSync(historyDir)) {
	fs.mkdirSync(historyDir);
}

var files = fs.readdirSync(historyDir);
/* istanbul ignore next */
for (var i in files) {
	fs.unlinkSync(historyDir + '/' + files[i]);
}


/**
	opts - JSON

	{
		hostIndex: 0,		//{Optional} (default 0) start index from the hosts list
		hosts: [192.168.1.233, 192.168.1.234, ...], //ip address or hostname
		port: 22,			//{Optional} port number
		username: admin,	//login name {Optional}
		password: pwd,		//password {Optional}: if privateKey missing
		privateKey: pks, 	//privateKeyString {Optional},
		shell: false,		//open SSH shell,
		timeout: 2000,		//connect timeout,
		history_limit: 10	//limit of last mail queue
		emit: function(state, data) { //{Optional} - console output handler
			console.log(state, data);	 //state - 5 states: CLOSE/EXIT/STDOUT/STDERR/DEBUG
		}),								 //data - output value
		intercept: function(next, rulekey, rulevalue, cmdLines, info) { 	//{Optional} - intercept while building an email body. Customizing boundary block
			next();
		})
	}
*/
module.exports = sendmailjs = function(opts) {
	if (opts.echo === undefined) {
		if (opts.smtp) {
			opts.echo = '';
			opts.echo_line = '\r\n';
			opts.port = opts.port || 25;
		} else {
			opts.echo = 'echo -e ';
			opts.echo_line = 'echo ';
		}
	}

	opts.hostIndex = opts.hostIndex || 0;
	opts.hosts = opts.hosts || ['localhost'];
	opts.port = opts.port || 22;
	opts.history_limit = opts.history_limit || 10;

	if (typeof opts.hosts === 'string') {
		opts.hosts = [opts.hosts];
	} else if (opts.hosts.length === 0) {
		throw new Error('Server hosts array is empty.');
	}
	
	return {
		/**
			callback(err, cmdLines, resourceInfo);
		*/
		build: function(rules, callback) {
			build(opts, rules, callback);
		},
		/**
			callback(err, status);
		*/
		send: function(cmdLines, callback) {
			send(opts, cmdLines, callback);
		},
		/**
			callback(err, client, stream);
		*/
		connect: function(callback) {
			connect(opts, sendmailjs.getHost(opts), callback);
			return exec;
		},
		/**
			callback(err, stream);
		*/
		exec: function(client, cmd, callback, fileName, host) {
			exec(opts, client, cmd, callback, fileName, host);
		}
	};
};

//private function
function connect(opts, host, callback) {
	var emit = opts.emit || sendmailjs.defConsole;

	var client;
	if (host === 'localhost') {
		client = child_process;
		callback(null, client);
	} else {
		client = new ssh2();
		client.host = host;

		var node = {
				host: host,
				port: opts.port,
				username: opts.username,
				readyTimeout: opts.timeout || 2000
			};

		if (opts.privateKey) {
			node.privateKey = opts.privateKey;
		}
		if (opts.password) {
			node.password = opts.password;
		}

		client.on('ready', function() {
			emit(sendmailjs.DEBUG, 'ready: ' + host);

			if (opts.shell === true) {
				client.shell(function(err, stream) {
					var code = 0;
					if (err) {
						return callback(err, client, stream);
					}
					stream.on('exit', function(code) {
						emit(sendmailjs.EXIT, code);
						client.end();
					});
					stream.on('close', function() {
						emit(sendmailjs.CLOSE, host);
						client.end();
					});
					stream.on('data', function(data) {
						emit(sendmailjs.STDOUT, data.toString());
					});
					stream.stderr.on('data', function(data) {
						code = -1;
						emit(sendmailjs.STDERR, data.toString());
					});
					callback(null, client, stream);
				});
			} else {
				callback(null, client, null);
			}
		}).connect(node);
	}
}

//private function
function exec(opts, client, cmd, callback, fileName, host) {
	var emit = opts.emit || sendmailjs.defConsole;

	host = host || sendmailjs.getHost(opts);

	emit(sendmailjs.DEBUG, 'cmd: ' + cmd);
	emit(sendmailjs.DEBUG, 'fileName: ' + fileName);
	emit(sendmailjs.DEBUG, 'host: ' + host);

	if (host === 'localhost') {
		if (cmd === 'send') {
			cmd = 'sh ' + fileName;
		}
		client.exec(cmd, function (error, stdout) {
			if (stdout) {
				emit(sendmailjs.STDOUT, stdout);
			} else {
				emit(sendmailjs.STDERR, error);
			}
			callback(error, stdout);
		});
	} else {
		if (cmd === 'send') {
			cmd = fs.readFileSync(fileName, 'utf8');
		}

		//Warning by execute the large comand line argument you may get an error
		//Error: Packet corrupt
		//The actual error is "spawn E2BIG" means that the argument list is too long
		//Please run getconf ARG_MAX to check the max argument size (in bytes) 

		client.exec(cmd, { pty: false }, function(err, stream) {
			var stderr = '';
			if (err) {
				emit(sendmailjs.STDERR, err.toString());
				return callback(err);
			}
			stream.on('exit', function(code) {
				emit(sendmailjs.EXIT, code);
				client.end();
			});
			stream.on('close', function() {
				emit(sendmailjs.CLOSE, client.host);
				client.end();
			});
			stream.on('data', function(data) {
				emit(sendmailjs.STDOUT, data.toString());
			});
			stream.stderr.on('data', function(data) {
				stderr += data;
				emit(sendmailjs.STDERR, data.toString());
			});
			callback(null, stream);
		});
	}
}

//private function
function build(opts, rules, callback) {
	var intercept = opts.intercept || sendmailjs.defIntercept;

	rules = rules || {};

	try {
		var ruleOrder = [];
			ruleOrder = ruleOrder.concat(rules.date ? {key: 'date', value: rules.date}: []);
			ruleOrder = ruleOrder.concat(rules.from ? {key: 'from', value: rules.from}: []);
			ruleOrder = ruleOrder.concat(rules.to && rules.to.length ? {key: 'to', value: rules.to}: []);
			ruleOrder = ruleOrder.concat(rules.cc && rules.cc.length ? {key: 'cc', value: rules.cc}: []);
			ruleOrder = ruleOrder.concat(rules.bcc && rules.bcc.length ? {key: 'bcc', value: rules.bcc}: []);
			ruleOrder = ruleOrder.concat(rules.subject ? {key: 'subject', value: rules.subject}: []);
			ruleOrder.push({key: 'MIME'});
			for (var c in rules.contents) {
				ruleOrder.push({key: 'contents', value: rules.contents[c]});
			}
			for (var a in rules.attachments) {
				ruleOrder.push({key: 'attachments', value: rules.attachments[a]});
			}

			var cmdLines = [],
				info = {
					contents: [],
					attachments: []
				},
				unescape = function(str) {
					if (str !== null && str !== undefined) {
						return str.replace('\'', '\\047');
					} else {
						return '';
					}
				},
				format = function(str) {
					if (opts.smtp) {
						return str;
					}
					return '\'' + str + '\'';
				},
				emails = function(name, list) {
					var emails = [];
					for (var i in list) {
						var item = list[i];
						if (item.name) {
							emails.push(unescape(item.name + ' <' + item.email) + '>');
						} else {
							emails.push(item.email);
						}
					}
					return opts.echo + name + ': "' + emails.join(', ') + '"';
				},
				getValue = function(key) {
					var keys = key.split('.'),
						source = rules;
					for (var i in keys) {
						if (source) {
							source = source[keys[i]];
						}
					}
					return source;
				},
				next = function() {

					if (cmdLines.length >= ruleOrder.length) {
						return callback(null, cmdLines, info);
					}

					var rule = ruleOrder[cmdLines.length],
						lines = [];

					intercept(function(skip) {
						
						if (!skip) {
							switch(rule.key) {
								case 'date':
									lines.push(opts.echo + 'Date: ' + unescape(rule.value));
									break;
								case 'subject':
									if (rule.value && rule.value.text) {
										lines.push(opts.echo + 'Subject: ' + unescape(rule.value.text));
									}
									break;
								case 'from':
									lines.push(emails('From', [rule.value]));
									break;
								case 'to':
									lines.push(emails('To', rule.value));
									break;
								case 'cc':
									lines.push(emails('Cc', rule.value));
									break;
								case 'bcc':
									lines.push(emails('Bcc', rule.value));
									break;
								case 'MIME':
									lines.push(opts.echo + 'MIME-Version: 1.0');
									lines.push(opts.echo + format('Content-Type: multipart/mixed; boundary="CONTENT_BOUNDARY"'));
									lines.push(opts.echo_line);
									break;
								case 'contents':
									var item = rule.value, content,
										contentType = (item['content-type'] || 'text/html');
									lines.push(opts.echo + '--CONTENT_BOUNDARY');
									lines.push(opts.echo + format('Content-Type: ' + contentType + '; charset=utf-8'));
									lines.push(opts.echo_line);
									if (item.template) {
										content = fs.readFileSync(item.template, 'utf8');
									} else {
										content = item.content;
									}
									for (var r in item.regexp) {
										var regexp = item.regexp[r],
											sIndx = regexp.pattern.lastIndexOf('/'),
											pattern = regexp.pattern.substring(1, sIndx),
											options = regexp.pattern.substring(sIndx + 1),
											value = regexp.key ? getValue(regexp.key) : regexp.value;
										content = content.replace(new RegExp(pattern, options), value);
									}
									if (opts.smtp !== true) {
										content = JSON.stringify(unescape(content));
									}
									info.contents.push({
										'content-type': contentType,
										'length': content.length,
										'bytes': Buffer.byteLength(content, 'utf8'),
										'index': cmdLines.length
									});
									lines.push(opts.echo + content);
									lines.push(opts.echo_line);
									break;
								case 'attachments':
									var image64, filename,
										bytes = 0;
									item = rule.value;

									if (item.data) {
										image64 = item.data;
									} else if (item.path) {
										var index = item.path.replace(/\\/g,'/').lastIndexOf('/');
										if (index !== -1) {
											filename = item.path.substring(index + 1);
										} else {
											filename = item.path;
										}
										image64 = new Buffer(fs.readFileSync(item.path)).toString('base64');
									}
									lines.push(opts.echo + '--CONTENT_BOUNDARY');
									if (item['content-type']) {
										if (item.name) {
											lines.push(opts.echo + format('Content-Type: ' + item['content-type'] + '; name=' + item.name));
										} else {
											lines.push(opts.echo + format('Content-Type: ' + item['content-type']));
										}
									}
									lines.push(opts.echo + format('Content-Transfer-Encoding: base64'));
									if (filename) {
										lines.push(opts.echo + format('Content-Disposition: attachment; filename=' + filename));
									}
									if (item.cid) {
										lines.push(opts.echo + format('Content-ID: <' + item.cid + '>'));
									}
									lines.push(opts.echo_line);
									if (image64) {
										lines.push(opts.echo + image64);
										bytes = ((image64.length * 3) / 4) - (image64.indexOf('=') > 0 ? 1 : 0);
									}
									info.attachments.push({
										'content-type': item['content-type'],
										'length': image64 ? image64.length : 0,
										'bytes': bytes,
										'index': cmdLines.length
									});

									lines.push(opts.echo_line);
									break;
							}

							cmdLines.push(lines);
						}
						next();
					}, rule.key, rule.value, cmdLines, info);
				};

		next();
	} catch (e) {
		callback(e);
	}
}

//private function
function send(opts, cmdLines, callback) {
	var emit = opts.emit || sendmailjs.defConsole;

	if (opts.hostIndex >= opts.hosts.length) {
		opts.hostIndex = 0;
	}
	emit(sendmailjs.DEBUG, opts);

	if (opts.smtp) {
		require('./smtp')(opts, cmdLines, callback);
		return;
	}

	var fileName = historyDir + '/mail' + Date.now() + '_' + Math.floor((1 + Math.random()) * 0x10000),
		host = sendmailjs.getHost(opts),
		cmd = ['(\n'];

	for (var i in cmdLines) {
		cmd.push(cmdLines[i].join(';\n') + ';\n');
	}
	cmd.push(opts.echo + '--CONTENT_BOUNDARY--;\n');
	cmd.push(') | /usr/sbin/sendmail -t -v');

	emit(sendmailjs.DEBUG, 'History Size: ' + lastMailHistory.length + ', Max Size: ' + opts.history_limit);
	if (lastMailHistory.length >= opts.history_limit) {
		try {
			fs.unlinkSync(lastMailHistory.shift());
		} catch (e) {
			/* istanbul ignore next */
			console.error(e);
		}
	}

	fs.writeFile(fileName, cmd.join(''), function (err) {
		/* istanbul ignore next */
		if (err) {
			callback(err);
		} else {
			lastMailHistory.push(fileName);
			emit(sendmailjs.DEBUG, 'Saved File: ' + fileName);
			connect(opts, host, function(err, client) {
				if (err) {
					return callback(err);
				}
				exec(opts, client, 'send', function(err) {
					if (err) {
						callback(err);
					} else {
						callback(err, 'SENDING...');
					}
				}, fileName, host);
			});
		}
	});
}

//static constants
sendmailjs.CLOSE  = 'CLOSE';
sendmailjs.EXIT   = 'EXIT';
sendmailjs.STDOUT = 'STDOUT';
sendmailjs.STDERR = 'STDERR';
sendmailjs.DEBUG  = 'DEBUG';

sendmailjs.getHost = function(opts) {
	if (opts.hostIndex >= opts.hosts.length) {
		opts.hostIndex = 0;
	}
	return opts.hosts[opts.hostIndex++];
};

sendmailjs.defConsole = function(
		// jshint ignore:start
		state, data
		// jshint ignore:end
	) {
};

sendmailjs.defIntercept = function(
	next
	// jshint ignore:start
	, propkey, propval, index
	// jshint ignore:end
	) {
	next(false);
};
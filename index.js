'use strict';

var ssh2 = require('ssh2'),
	fs = require('fs'),
	defConsole = function(
		// jshint ignore:start
		state, data
		// jshint ignore:end
	) {
	},
	defIntercept = function(
		next
		// jshint ignore:start
		, propkey, propval, index
		// jshint ignore:end
		) {
		next();
	},
	sendmailjs;

/**
	opts - JSON

	{
		hosts: [192.168.1.233, 192.168.1.234, ...], //ip address of VMs
		hostIndex: 0,		//{Optional} (default 0) start index from the hosts list
		port: 22,			//ssh port
		username: admin,	//login name
		password: pwd,		//password {Optional}: if privateKey missing
		privateKey: pks, 	//privateKeyString,
		shell: false,		//open SSH shell,
		timeout: 2000,		//connect timeout,
		debug: function(state, data) { //{Optional} - debug output
			console.log(state, data);	 //state - 5 states: CLOSE/EXIT/STDOUT/STDERR/DEBUG
		}),								 //data - output value
		intercept: function(next, rulekey, rulevalue, ruleindex) { 	//{Optional} - intercept while building an email body. Customizing boundary block
			next();													//next - callback function
		})															//rulekey - the current rule key 
	}																//rulevalue - the rule properties 
																	//ruleindex - the rule order index
*/
module.exports = sendmailjs = function(opts) {
	opts.hostIndex = opts.hostIndex || 0;
	opts.hosts = opts.hosts || ['localhost'];
	opts.port = opts.port || 22;

	return {
		/**
			callback(err, client, stream);
		*/
		connect: function(callback) {
			connect(opts, callback);
		},
		/*
			callback(null, stream);
		*/
		exec: function(client, cmd, callback) {
			exec(opts, client, cmd, callback);
		},
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
		}
	};
};

//private function
function connect(opts, callback) {
	var debug = opts.debug || defConsole;

	if (opts.hostIndex < opts.hosts.length) {
		var client = new ssh2(),
			ip = opts.hosts[opts.hostIndex++],
			node = {
				host: ip,
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

		client.ip = ip;

		client.on('ready', function() {
			debug(sendmailjs.DEBUG, 'ready: ' + ip);

			if (opts.shell === true) {
				client.shell(function(err, stream) {
					var code = 0;
					if (err) {
						return callback(err);
					}
					stream.on('exit', function(code) {
						debug(sendmailjs.EXIT, code);
						client.end();
					});
					stream.on('close', function() {
						debug(sendmailjs.CLOSE, ip);
						client.end();
					});
					stream.on('data', function(data) {
						debug(sendmailjs.STDOUT, data.toString());
					});
					stream.stderr.on('data', function(data) {
						code = -1;
						debug(sendmailjs.STDERR, data.toString());
					});
					callback(null, client, stream);
				});
			} else {
				callback(null, client, null);
			}
		}).connect(node);
	} else {
		debug(sendmailjs.DEBUG, 'Missing host list');
		callback(new Error('Missing host list'), null);
	}

	if (opts.hostIndex >= opts.hosts.length) {
		opts.hostIndex = 0;
	}
}

//private function
function exec(opts, client, cmd, callback) {
	var debug = opts.debug || defConsole;

	client.exec(cmd, { pty: false }, function(err, stream) {
		var stderr = '';
		if (err) {
			debug(sendmailjs.STDERR, err.toString());
			return callback(err);
		}
		stream.on('exit', function(code) {
			debug(sendmailjs.EXIT, code);
			client.end();
		});
		stream.on('close', function() {
			debug(sendmailjs.CLOSE, client.ip);
			client.end();
		});
		stream.on('data', function(data) {
			debug(sendmailjs.STDOUT, data.toString());
		});
		stream.stderr.on('data', function(data) {
			stderr += data;
			debug(sendmailjs.STDERR, data.toString());
		});
		callback(null, stream);
	});
}

//private function
function build(opts, rules, callback) {
	var intercept = opts.intercept || defIntercept;

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

			var ruleindex = -1,
				cmdLines = [],
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
					return 'echo ' + name + ': "' + emails.join(', ') + '";';
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

					ruleindex++;

					if (ruleindex >= ruleOrder.length) {
						return callback(null, cmdLines, info);
					}

					var rule = ruleOrder[ruleindex],
						lines = [];

					intercept(function() {
					
						switch(rule.key) {
							case 'date':
								lines.push('echo Date: ' + unescape(rule.value) + ';');
								break;
							case 'subject':
								if (rule.value && rule.value.text) {
									lines.push('echo Subject: \'' + unescape(rule.value.text) + '\';');
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
								lines.push('echo MIME-Version: 1.0;');
								lines.push('echo \'Content-Type: multipart/mixed; boundary="CONTENT_BOUNDARY"\';');
								lines.push('echo ;');
								break;
							case 'contents':
								var item = rule.value, content,
									contentType = (item['content-type'] || 'text/html');
								lines.push('echo --CONTENT_BOUNDARY;');
								lines.push('echo \'Content-Type: ' + contentType + '; charset=utf-8\';');
								lines.push('echo ;');
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
								content = JSON.stringify(unescape(content));
								info.contents.push({
									'content-type': contentType,
									'length': content.length,
									'bytes': Buffer.byteLength(content, 'utf8'),
									'index': cmdLines.length
								});
								lines.push('echo -e ' + content + ';');
								lines.push('echo ;');
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
								lines.push('echo --CONTENT_BOUNDARY;');
								if (item['content-type']) {
									if (item.name) {
										lines.push('echo \'Content-Type: ' + item['content-type'] + '; name=' + item.name + '\';');
									} else {
										lines.push('echo \'Content-Type: ' + item['content-type'] + ';');
									}
								}
								lines.push('echo \'Content-Transfer-Encoding: base64\';');
								if (filename) {
									lines.push('echo \'Content-Disposition: attachment; filename=' + filename + '\';');
								}
								if (item.cid) {
									lines.push('echo \'Content-ID: <' + item.cid + '>\';');
								}
								lines.push('echo ;');
								if (image64) {
									lines.push('echo ' + image64);
									bytes = ((image64.length * 3) / 4) - (image64.indexOf('=') > 0 ? 1 : 0);
								}
								info.attachments.push({
									'content-type': item['content-type'],
									'length': image64 ? image64.length : 0,
									'bytes': bytes,
									'index': cmdLines.length
								});

								lines.push('echo ;');
								break;
						}

						cmdLines.push(lines);
						next();
					}, rule.key, rule.value, ruleindex);
				};

		next();
	} catch (e) {
		callback(e);
	}
}

//private function
function send(opts, cmdLines, callback) {
	var cmd = '(\n';
	for (var i in cmdLines) {
		cmd += cmdLines[i].join('\n') + '\n';
	}
	cmd += 'echo --CONTENT_BOUNDARY--;\n';
	cmd += ') | /usr/sbin/sendmail -t -v';

	connect(opts, function(err, client) {
		if (err) {
			return callback(err);
		}
		exec(opts, client, cmd, function(err) {
			if (err) {
				callback(err);
			} else {
				callback(err, 'SENT');
			}
		});
	});
}

//static constants
sendmailjs.CLOSE  = 'CLOSE';
sendmailjs.EXIT   = 'EXIT';
sendmailjs.STDOUT = 'STDOUT';
sendmailjs.STDERR = 'STDERR';
sendmailjs.DEBUG  = 'DEBUG';
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
		port: 22,			//ssh port
		username: admin,	//login name
		password: pwd,		//password {Optional}: if privateKey missing
		privateKey: pks, 	//privateKeyString,
		shell: false,		//open SSH shell,
		timeout: 2000,		//connect timeout,
		console: function(state, data) { //{Optional} - output console
			console.log(state, data);	 //state - 5 states: CLOSE/EXIT/STDOUT/STDERR/DEBUG
		}),								 //data - output value
		intercept: function(next, rulekey, rulevalue, ruleindex) { 	//{Optional} - intercept while building an email body. Customizing boundary block
			next();													//next - callback function
		})															//rulekey - the current rule key 
	}																//rulevalue - the rule properties 
																	//ruleindex - the rule order index
*/
module.exports = sendmailjs = function(opts) {
	opts.connectIndex = 0;

	return {
		connect: function(callback) {
			connect(opts, callback);
		},
		exec: function(client, cmd, callback) {
			exec(opts, client, cmd, callback);
		},
		build: function(rules, callback) {
			build(opts, rules, callback);
		},
		send: function(cmdLines, callback) {
			send(opts, cmdLines, callback);
		}
	};
};

//private function
function connect(opts, callback) {
	var console = opts.console || defConsole;

	if (opts.connectIndex >= opts.hosts.length) {
		opts.connectIndex = 0;
	}

	if (opts.hosts && opts.connectIndex < opts.hosts.length) {
		var client = new ssh2(),
			ip = opts.hosts[opts.connectIndex++],
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
			console(sendmailjs.DEBUG, 'ready: ' + ip);

			if (opts.shell === true) {
				client.shell(function(err, stream) {
					var code = 0;
					if (err) {
						return callback(err);
					}
					stream.on('exit', function(code) {
						console(sendmailjs.EXIT, code);
						client.end();
					});
					stream.on('close', function() {
						console(sendmailjs.CLOSE, ip);
						client.end();
					});
					stream.on('data', function(data) {
						console(sendmailjs.STDOUT, data.toString());
					});
					stream.stderr.on('data', function(data) {
						code = -1;
						console(sendmailjs.STDERR, data.toString());
					});
					callback(null, client, stream);
				});
			} else {
				callback(null, client, null);
			}
		}).connect(node);
	} else {
		console(sendmailjs.DEBUG, 'Missing host list');
		callback(new Error('Missing host list'), null);
	}
}

//private function
function exec(opts, client, cmd, callback) {
	var console = opts.console || defConsole;

	client.exec(cmd, { pty: false }, function(err, stream) {
		var stderr = '';
		if (err) {
			console(sendmailjs.STDERR, err.toString());
			return callback(err);
		}
		stream.on('exit', function(code) {
			console(sendmailjs.EXIT, code);
			client.end();
		});
		stream.on('close', function() {
			console(sendmailjs.CLOSE, client.ip);
			client.end();
		});
		stream.on('data', function(data) {
			console(sendmailjs.STDOUT, data.toString());
		});
		stream.stderr.on('data', function(data) {
			stderr += data;
			console(sendmailjs.STDERR, data.toString());
		});
		callback(null, stream);
	});
}

//private function
function build(opts, rules, callback) {
	var intercept = opts.intercept || defIntercept;

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
				cmdLines = ['('],
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
						source = source[keys[i]];
					}
					return source;
				},
				next = function() {

					ruleindex++;

					if (ruleindex >= ruleOrder.length) {
						cmdLines.push('echo --CONTENT_BOUNDARY--;');
						cmdLines.push(') | /usr/sbin/sendmail -t -v');
						return callback(null, cmdLines);
					}

					var rule = ruleOrder[ruleindex],
						lines = [];

					intercept(function() {
					
						switch(rule.key) {
							case 'date':
								lines.push('echo Date: ' + unescape(rule.value) + ';');
								break;
							case 'subject':
								lines.push('echo Subject: \'' + unescape(rule.value) + '\';');
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
								var item = rule.value, content;
								lines.push('echo --CONTENT_BOUNDARY;');
								lines.push('echo \'Content-Type: ' + (item['content-type'] || 'text/html') + '; charset=utf-8\';');
								lines.push('echo ;');
								if (item.template) {
									content = fs.readFileSync(item.template, 'utf8');
								} else {
									content = item.content;
								}
								for (var r in item.regexp) {
									var regexp = item.regexp[r],
										pattern = regexp.pattern.split('/'),
										value = regexp.key ? getValue(regexp.key) : regexp.value;
									content = content.replace(new RegExp(pattern[1], pattern[2]), value);
								}
								lines.push('echo -e ' + JSON.stringify(unescape(content)) + ';');
								lines.push('echo ;');
								break;
							case 'attachments':
								var image64, filename;
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
								}
								lines.push('echo ;');
								break;
						}

						cmdLines = cmdLines.concat(lines);
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
	connect(opts, function(err, client) {
		if (err) {
			return callback(err);
		}
		exec(opts, client, cmdLines.join('\n'), function(err) {
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
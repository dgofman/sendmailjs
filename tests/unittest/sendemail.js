'use strict';

var dir = process.cwd(),
	sendemail = require(dir + '/index'),
	fs = require('fs'),
	assert = require('assert'),
	Server = require(dir + '/node_modules/ssh2/lib/server'),
	HOST_KEY_RSA = fs.readFileSync(dir + '/node_modules/ssh2/test/fixtures/ssh_host_rsa_key');

var host_name = '127.0.0.1',
	port = 22,
	username = 'admin',
	password = 'pwd';

var rules = {
	"team": "Softigent Team.",
	"date": "$(date -R)", 
	"from": {
		"name": "DO NOT REPLY",
		"email": "test@softigent.com"
	},
	"to": [
		{
			"name": "David Gofman",
			"email": "dgofman@gmail.com"
		},
		{
			"name": "Gofman David",
			"email": "dgofman@softigent.com"
		}
	],
	"cc": [
		{
			"email": "dgofman@gmail.com"
		}
	],
	"bcc": [
		{
			"email": "dgofman@gmail.com"
		}
	],
	"subject": {
		"text": "My Attachment with Logo"
	},
	"contents": [
		{
			"template": dir + "/tests/templates/template_logo.html",
			"regexp": [
				{"pattern": "/\\${LOGO}/g", "value": "cid:logo"},
				{"pattern": "/\\${COMPANY}/g", "value": "Softigent Inc."},
				{"pattern": "/\\${FROM}/g", "key": "team"},
				{"pattern": "/\\${TO}/g", "key": "to.0.name"},
				{"pattern": "/\\${INVALID}/g", "key": "invalid.name"},
				{"pattern": "/\\${DATE}/g", "value": new Date().toGMTString()}
			]
		},
		{
			"content-type": "text/plain",
			"content": "Hello World!"
		},
		{
			"content-type": "text/html"
		}
	],
	"attachments": [
		{
			"name": "company.png",
			"path": dir + "/tests/images/company_logo.png",
			"content-type": "image/png",
			"cid": "logo"
		},
		{
			"name": "indigo.png",
			"path": dir + "/tests/images/indigo_logo.png",
			"content-type": "image/png"
		},
		{
			"content-type": "image/png"
		},
		{
			"name": "avatar.png",
			"cid": "avatar"
		}
	]
};

describe('SendMailJS build and send', function () {

	it('should test build command', function(done) {
		var mail = sendemail({
			echo: 'ECHO -e ',
			echo_line: 'ECHO '
		});
		mail.build(rules, function(err, cmdLines, info) {
			assert.equal(err, null);
			assert.equal(info.contents.length, 3);
			assert.equal(info.attachments.length, 4);
			assert.equal(cmdLines[0][0], 'ECHO -e Date: $(date -R)');
			done();
		});
	});

	it('should test build command error', function(done) {
		var oldValue = rules.attachments[0].path,
			mail = sendemail({
			});
		rules.attachments[0].path = 'no_image.jpg';
		mail.build(rules, function(err) {
			rules.attachments[0].path = oldValue;
			assert.ok(err !== null);
			done();
		});
	});

	it('should test missing rules', function(done) {
		var mail = sendemail({
		});
		mail.build(null, function(err) {
			assert.ok(err === null);
			done();
		});
	});

	it('should test without subject text', function(done) {
		var oldValue = rules.subject.text,
			mail = sendemail({
			});

		delete rules.subject.text;
		mail.build(rules, function(err) {
			rules.subject.text = oldValue;
			assert.ok(err !== null);
			done();
		});
	});

	it('should test intercent function callback', function(done) {
		var str = 'THIS IS A JSON',
			mail = sendemail({	
			username: username,
			password: password,
			intercept: function(next, rulekey, rulevalue, cmdLines, info) {
				if (rulekey === 'contents') {
					if (info.contents.length === 0) { //replace first content with custom json
						var json = {key: str};
						info.contents.push({
							'content-type': 'text/json',
							'length': JSON.stringify(json).length,
							'index': cmdLines.length
						});
						cmdLines.push([json]);
						return next(true);
					}
				} else if (rulekey === 'attachments' && rulevalue.name === 'avatar.png') {
					rulevalue['content-type'] = 'image/mypng';
					rulevalue.data = new Buffer(fs.readFileSync(dir + "/tests/images/indigo_logo.png")).toString('base64');
				}
				next();
			}
		});

		mail.build(rules, function(err, cmdLines, info) {
			assert.equal(err, null);
			assert.equal(info.contents.length, 3);
			assert.equal(cmdLines[info.contents[0].index][0].key, str);
			assert.equal(info.attachments.length, 4);
			done();
		});
	});

	it('should test send email and history file limit', function(done) {
		createServer(function(server) {
			var mail = sendemail({
				hosts: [host_name],
				port: port,	
				username: username,
				history_limit: 1
			});

			server.on('connection', function(conn) {
				conn.on('authentication', function(ctx) {
					ctx.accept();
				}).on('ready', function() {
					conn.once('session', function(accept) {
						var session = accept();
						session.once('exec', function(accept) {
							var stream = accept();
							stream.exit(0);
							conn.end();
						});
					});
				});
			});

			mail.send([ ['line1'] ], function(err, result) {
				assert.ok(err === null);
				assert.equal(result, 'SENDING...');
				mail.send([ ['line1'] ], function(err, result) {
					assert.ok(err === null);
					assert.equal(result, 'SENDING...');
					done();
				});
			});
		});
	});

	it('should test send email failure', function(done) {
		createServer(function(server) {
			var mail = sendemail({
				hosts: [host_name],
				port: port,	
				username: username
				});

			server.on('connection', function(conn) {
				conn.on('authentication', function(ctx) {
					ctx.accept();
				}).on('ready', function() {
					conn.once('session', function(accept) {
						var session = accept();
						session.once('exec', function(accept, reject) {
							reject();
							conn.end();
						});
					});
				});
			});

			mail.send('', function(err) {
				assert.ok(err !== null);
				done();
			});
		});
	});

	it('should test sendmail using child_proccess (localhost)', function(done) {
		var mail = sendemail({
			hosts: ['localhost'],
			port: port
		});

		mail.connect(function(err, client) {
			var oldExec = client.exec;
			client.exec = function(cmd, callback) {
				callback(null, 'SENDING...');
			};
			mail.exec(client, '', function(err) {
				client.exec = oldExec;
				assert.ok(err === null);
				done();
			});
		});
	});

	it('should test sendmail on error using child_proccess (localhost)', function(done) {
		var mail = sendemail({
			hosts: ['localhost'],
			port: port
		});

		mail.connect(function(err, client) {
			var oldExec = client.exec;
			client.exec = function(cmd, callback) {
				callback('ERROR');
			};
			mail.exec(client, '', function(err) {
				client.exec = oldExec;
				assert.ok(err !== null);
				done();
			});
		});
	});

	it('should test send command', function(done) {
		var mail = sendemail({
			hosts: ['localhost'],
			port: port
		});

		var path = require('path'),
			files = fs.readdirSync('./tmp'),
			fileName;
		for (var i in files) {
			fileName = path.resolve('./tmp/' + files[i]);
			break;
		}

		mail.connect(function(err, client) {
			var oldExec = client.exec;
			client.exec = function(cmd, callback) {
				assert.ok(cmd.indexOf(fileName) !== -1);
				callback(cmd);
			};
			mail.exec(client, 'send', function(err) {
				client.exec = oldExec;
				assert.ok(err !== null);
				done();
			}, fileName);
		});
	});
});

function createServer(next) {
	var server = new Server({
		privateKey: HOST_KEY_RSA
	});
	server.listen(0, host_name, function() {
		port = server.address().port;
		next(server);
	});
	return server;
}
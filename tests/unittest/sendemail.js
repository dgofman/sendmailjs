'use strict';

var dir = process.cwd(),
	sendemail = require(dir + '/index'),
	fs = require('fs'),
	assert = require('assert'),
	Server = require(dir + '/node_modules/ssh2/lib/server'),
	HOST_KEY_RSA = fs.readFileSync(dir + '/node_modules/ssh2/test/fixtures/ssh_host_rsa_key');

var host_name = 'localhost',
	port = 22,
	username = 'admin';

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
	"subject": "My Attachment with Logo",
	"contents": [
		{
			"template": dir + "/tests/templates/template_logo.html",
			"regexp": [
				{"pattern": "/\\${LOGO}/g", "value": "cid:logo"},
				{"pattern": "/\\${COMPANY}/g", "value": "Softigent Inc."},
				{"pattern": "/\\${FROM}/g", "key": "team"},
				{"pattern": "/\\${TO}/g", "key": "to.0.name"},
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
		});
		mail.build(rules, function(err) {
			assert.ok(err === null);
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
		mail.build({}, function(err) {
			assert.ok(err === null);
			done();
		});
	});

	it('should test intercent function to replace image', function(done) {
		var mail = sendemail({	
			username: username,
			intercept: function(next, rulekey, rulevalue) {
				if (rulekey === 'attachments' && rulevalue.name === 'avatar.png') {
					rulevalue.data = new Buffer(fs.readFileSync(dir + "/tests/images/indigo_logo.png")).toString('base64');
				}
				next();
			}
		});

		mail.build(rules, function(err) {
			assert.ok(err === null);
			done();
		});
	});

	it('should test error on missing hosts', function(done) {
		var mail = sendemail({
			hosts: []
		});

		mail.send([], function(err) {
			assert.ok(err !== null);
			assert.equal(err.message, 'Missing host list');
			done();
		});
	});

	it('should test send email', function(done) {
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
						session.once('exec', function(accept) {
							var stream = accept();
							stream.exit(0);
							conn.end();
						});
					});
				});
			});

			mail.send([], function(err, result) {
				assert.ok(err === null);
				assert.equal(result, 'SENT');
				done();
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

			mail.send([], function(err) {
				assert.ok(err !== null);
				done();
			});
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
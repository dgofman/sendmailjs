'use strict';

var dir = process.cwd(),
	sendemail = require(dir + '/index'),
	net = require('net'),
	assert = require('assert');

var rules = {
	"date": "$(date -R)", 
	"from": {
		"name": "DO NOT REPLY",
		"email": "donot_reply@softigent.com"
	},
	"to": [
		{
			"name": "David Gofman",
			"email": "dgofman@gmail.com"
		}
	],
	"cc": [
		{
			"name": "David Gofman",
			"email": "dgofman@gmail.com"
		}
	],
	"bcc": [
		{
			"name": "David Gofman",
			"email": "dgofman@gmail.com"
		}
	],
	"subject": {
		"text": "Test"
	}
};

describe('SMTP', function () {

	it('should validate default opts', function(done) {
		var opts = {
			smtp: true
		};
		sendemail(opts);
		assert.equal(opts.echo, '');
		assert.equal(opts.echo_line, '\r\n');
		assert.equal(opts.port, 25);
		assert.equal(opts.hosts[0], 'localhost');
		done();
	});

	it('should test build command', function(done) {
		var mail = sendemail({
			smtp: true,
		});
		mail.build({contents: [{content: 'HELLO'}]}, function(err, cmdLines) {
			assert.equal(err, null);
			assert.equal(cmdLines[0].length, 3);
			done();
		});
	});

	it('should test SMTP send mail', function(done) {
		var clientSocket;
		createServer(function(socket) {
			clientSocket = socket;
			socket.on('data', function(data) {
				var str = data.toString();
				if (str.indexOf('EHLO') === 0) {
					return socket.write('250-localhost Hello [127.0.0.1]');
				}
				if (str.indexOf('MAIL FROM:') === 0) {
					return socket.write('250 2.1.0 Sender OK');
				}
				if (str.indexOf('RCPT TO:') === 0) {
					return socket.write('250 2.1.5 Recipient OK');
				}
				if (str.indexOf('DATA') === 0) {
					return socket.write('354 Start mail input; end with <CRLF>.<CRLF>');
				}
				if (str.indexOf('--CONTENT_BOUNDARY--') !== -1) {
					return socket.write('250 2.6.0. Queued mail for delivery');
				}
				if (str.indexOf('QUIT') === 0) {
					return socket.write('500 DO NOT CLOSE YET!');
				}
				if (str.indexOf('CLOSE NOW!') === 0) {
					return socket.write('221 2.0.0 Service closing transmission channel');
				}
			});

			socket.on('end', function() {
				done();
			});

			socket.write('220 localhost Microsoft ESMTP MAIL Service ready at ' + new Date().toString() + '\n');
		}, function(port) {
			var opts = {
				smtp: true,
				port: port,
				intercept: function(next, client, state, data, tasks) {
					if (state === '500') {
						assert.equal(tasks.length, 1);
						assert.equal(tasks[0], 'QUIT');
						assert.equal(data, '500 DO NOT CLOSE YET!');
						client.write('CLOSE NOW!' + '\n');
						return next(true);
					}
					next(false);
				}
			}, mail = sendemail(opts);

			mail.build(rules, function(err, cmdLines) {
				mail.send(cmdLines, function(err, result) {
					assert.equal(err, null);
					assert.equal(result, 'CLOSED');
				});
			});
		});
	});

	it('should test SMTP error', function(done) {
		var opts = {
			smtp: true,
			port: 65535
		}, mail = sendemail(opts);
		mail.build(rules, function(err, cmdLines) {
			mail.send(cmdLines, function(err) {
				assert.equal(err.code, 'ECONNREFUSED');
				assert.equal(err.errno, 'ECONNREFUSED');
				done();
			});
		});
	});
});

function createServer(listener, next) {
	var server = net.createServer(listener);
	server.listen(0, function() {
		var port = server.address().port;
		next(port);
	});
}
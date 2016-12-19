'use strict';

var dir = process.cwd(),
	sendemail = require(dir + '/index'),
	net = require('net'),
	assert = require('assert');

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
		var index = 0, clientSocket;
		createServer(function(socket) {
			clientSocket = socket;
			socket.on('data', function(data) {
				index++;
				var str = data.toString();
				if (str.indexOf('EHLO') === 0) {
					assert.equal(index, 1);
					return socket.write('250-localhost Hello [127.0.0.1]');
				}
				if (str.indexOf('MAIL FROM:') === 0) {
					assert.equal(index, 2);
					return socket.write('250 2.1.0 Sender OK');
				}
				if (str.indexOf('RCPT TO:') === 0) {
					assert.equal(index, 3);
					return socket.write('250 2.1.5 Recipient OK');
				}
				if (str.indexOf('DATA') === 0) {
					assert.equal(index, 4);
					return socket.write('354 Start mail input; end with <CRLF>.<CRLF>');
				}
				if (str.indexOf('--CONTENT_BOUNDARY--') !== -1) {
					assert.equal(index, 5);
					return socket.write('250 2.6.0. Queued mail for delivery');
				}
				if (str.indexOf('QUIT') === 0) {
					assert.equal(index, 6);
					return socket.write('500 DO NOT CLOSE YET!');
				}
				if (str.indexOf('CLOSE NOW!') === 0) {
					assert.equal(index, 7);
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
				intercept: function(next, client, state, data) {
					if (state === '500') {
						assert.equal(data, '500 DO NOT CLOSE YET!');
						client.write('CLOSE NOW!' + '\n');
						return next(true);
					}
					next(false);
				}
			}, mail = sendemail(opts);

			mail.send({ contents: [{
					'content-type': 'text/plain',
					'content': 'Hello World!'
				}] }, function(err, result) {
					assert.equal(err, null);
					assert.equal(result, 'CLOSED');
			});
		});
	});

	it('should test SMTP error', function(done) {
		var opts = {
			smtp: true,
			port: 65535
		}, mail = sendemail(opts);
		mail.send(null, function(err) {
			assert.equal(err.code, 'ECONNREFUSED');
			assert.equal(err.errno, 'ECONNREFUSED');
			done();
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
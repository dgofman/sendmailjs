'use strict';

var dir = process.cwd(),
	sendemail = require(dir + '/index'),
	dns = require('dns'),
	fs = require('fs'),
	assert = require('assert'),
	Server = require(dir + '/node_modules/ssh2/lib/server'),
	HOST_KEY_RSA = fs.readFileSync(dir + '/node_modules/ssh2/test/fixtures/ssh_host_rsa_key');

var host_name = '127.0.0.1',
	port = 22,
	username = 'admin',
	password = 'welcome1';

describe('SendMailJS connect and exec', function () {

	it('should test resolve ip from domain', function(done) {
		dns.resolve4('www.google.com', function (err, ips) {
			assert.ok(err === null);
			assert.ok(ips.length > 0);
			done();
		});
	});

	it('should test resolve ip by host name', function(done) {
		dns.lookup(host_name, null, function(err, ip) {
			assert.ok(err === null);
			assert.equal(ip.split('.').length, 4);
			done();
		});
	});

	it('should test without hosts', function(done) {
		var mail = sendemail({
			hosts: [],
			port: port,	
			username: username
		});
		mail.connect(function(err, stream) {
			assert.ok(err !== null);
			assert.equal(err.message, 'Missing host list');
			assert.equal(stream, null);
			done();
		});
	});

	it('should test Shell flag is false', function(done) {
		createServer(function(server) {
			var mail = sendemail({
					hosts: [host_name],
					port: port,	
					username: username,
					shell: false, 
					debug: function(state, data) {
						assert.equal(state, sendemail.DEBUG);
						assert.equal(data, 'ready: 127.0.0.1', 'DEBUG');
					}
				});

			server.on('connection', function(conn) {
				conn.on('authentication', function(ctx) {
					ctx.accept();
				});
			});

			mail.connect(function(err, client, stream) {
				assert.ok(err === null);
				assert.ok(stream === null);
				assert.ok(client !== null);
				done();
			});
		});
	});

	it('should test Error: (SSH) Channel open failure', function(done) {
		createServer(function(server) {
			var mail = sendemail({
					hosts: [host_name, '192.168.1.10'],
					hostIndex: 0,
					port: port,	
					username: username,
					privateKey: HOST_KEY_RSA,
					shell: true
				});

			server.on('connection', function(conn) {
				conn.on('authentication', function(ctx) {
					ctx.accept();
				});
			});

			mail.connect(function(err) {
				assert.ok(err !== null);
				done();
			});
		});
	});

	it('should test valid shell communication', function(done) {
		createServer(function(server) {
			var exitCode = 0,
				states = {},
				mail = sendemail({
					hosts: [host_name],
					port: port,	
					username: username,
					password: password,
					shell: true,
					debug: function(state, data) {
						states[state] = data;
						if (state === sendemail.CLOSE) {
							assert.equal(states[sendemail.DEBUG], 'ready: 127.0.0.1', 'DEBUG');
							assert.equal(states[sendemail.STDOUT], 'OK', 'STDOUT');
							assert.equal(states[sendemail.EXIT], exitCode, 'EXIT');
							assert.equal(states[sendemail.CLOSE], '127.0.0.1', 'CLOSE');
							done();
						}
					}
				});

			server.on('connection', function(conn) {
				conn.on('authentication', function(ctx) {
					ctx.accept();
				}).on('ready', function() {
					conn.once('session', function(accept, reject) {
						assert.ok(typeof reject === 'function');
						var session = accept();
						session.once('pty', function(accept, reject, info) {
							assert.ok(info !== null);
							accept && accept();
						}).once('shell', function(accept, reject) {
							assert.ok(typeof reject === 'function');
							var stream = accept();
							stream.on('data', function(data) {
								assert.equal(data, 'exit');
								stream.write('OK');
								stream.exit(exitCode);
								conn.end();
							});
						});
					});
				});
			});

			mail.connect(function(err, client, stream) {
				assert.ok(err === null);
				stream.end('exit');
			});
		});
	});

	it('should test invalid shell communication', function(done) {
		createServer(function(server) {
			var exitCode = 666,
				states = {},
				mail = sendemail({
					hosts: [host_name],
					port: port,	
					username: username,
					password: password,
					shell: true,
					debug: function (state, data) {
						states[state] = data;
						if (state === sendemail.CLOSE) {
							assert.equal(states[sendemail.DEBUG], 'ready: 127.0.0.1', 'DEBUG');
							assert.equal(states[sendemail.STDERR], 'FAULT', 'STDERR');
							assert.equal(states[sendemail.EXIT], exitCode, 'EXIT');
							assert.equal(states[sendemail.CLOSE], '127.0.0.1', 'CLOSE');
							done();
						}
					}
				});

			server.on('connection', function(conn) {
				conn.on('authentication', function(ctx) {
					ctx.accept();
				}).on('ready', function() {
					conn.once('session', function(accept, reject) {
						assert.ok(typeof reject === 'function');
						var session = accept();
						session.once('pty', function(accept, reject, info) {
							assert.ok(info !== null);
							accept && accept();
						}).once('shell', function(accept, reject) {
							assert.ok(typeof reject === 'function');
							var stream = accept();
							stream.on('data', function(data) {
								assert(data.toString(), 'exit');
								stream.stderr.write('FAULT');
								stream.exit(exitCode);
								conn.end();
							});
						});
					});
				});
			});

			mail.connect(function(err, client, stream) {
				assert.ok(err === null);
				stream.end('exit');
			});
		});
	});

	it('should test connection close before execute command', function(done) {
		createServer(function(server) {
			var mail = sendemail({
					hosts: [host_name],
					port: port,	
					username: username,
					shell: false
				});

			server.on('connection', function(conn) {
				conn.on('authentication', function(ctx) {
					ctx.accept();
				});
			});

			mail.connect(function(err, client) {
				client.end();
				mail.exec(client, 'exit', function(err) {
					assert.ok(err !== null);
					done();
				});
			});
		});
	});

	it('should test connection close before execute command with debug monitoring', function(done) {
		createServer(function(server) {
			var states = {},
				mail = sendemail({
					hosts: [host_name],
					port: port,	
					username: username,
					shell: false,
					debug: function (state, data) {
							states[state] = data;
							if (state === sendemail.STDERR) {
								assert.equal(states[sendemail.DEBUG], 'ready: 127.0.0.1', 'DEBUG');
								assert.equal(states[sendemail.STDERR], 'Error: No response from server', 'STDERR');
								done();
							}
						}
					});

			server.on('connection', function(conn) {
				conn.on('authentication', function(ctx) {
					ctx.accept();
				});
			});

			mail.connect(function(err, client) {
				client.end();
				mail.exec(client, 'exit', function(err) {
					assert.ok(err !== null);
				});
			});
		});
	});

	it('should test execute command', function(done) {
		createServer(function(server) {
			var exitCode = 0,
				states = {},
				mail = sendemail({
					hosts: [host_name],
					port: port,	
					username: username,
					shell: false,
					debug: function (state, data) {
							states[state] = data;
							if (state === sendemail.CLOSE) {
								assert.equal(states[sendemail.DEBUG], 'ready: 127.0.0.1', 'DEBUG');
								assert.equal(states[sendemail.STDOUT], 'OK', 'STDOUT');
								assert.equal(states[sendemail.EXIT], exitCode, 'EXIT');
								assert.equal(states[sendemail.CLOSE], '127.0.0.1', 'CLOSE');
								done();
							}
						}
					});

			server.on('connection', function(conn) {
				conn.on('authentication', function(ctx) {
					ctx.accept();
				}).on('ready', function() {
					conn.once('session', function(accept) {
						var session = accept();
						session.once('exec', function(accept, reject, info) {
							assert.equal(info.command, 'exit');
							var stream = accept();
							stream.write('OK');
							stream.exit(exitCode);
							conn.end();
						});
					});
				});
			});

			mail.connect(function(err, client) {
				mail.exec(client, 'exit', function(err) {
					assert.ok(err === null);
				});
			});
		});
	});

	it('should test fault execute command', function(done) {
		createServer(function(server) {
			var exitCode = 666,
				states = {},
				mail = sendemail({
					hosts: [host_name],
					port: port,	
					username: username,
					shell: false,
					debug: function (state, data) {
							states[state] = data;
							if (state === sendemail.CLOSE) {
								assert.equal(states[sendemail.DEBUG], 'ready: 127.0.0.1', 'DEBUG');
								assert.equal(states[sendemail.STDERR], 'FAULT', 'STDOUT');
								assert.equal(states[sendemail.EXIT], exitCode, 'EXIT');
								assert.equal(states[sendemail.CLOSE], '127.0.0.1', 'CLOSE');
								done();
							}
						}
					});

			server.on('connection', function(conn) {
				conn.on('authentication', function(ctx) {
					ctx.accept();
				}).on('ready', function() {
					conn.once('session', function(accept) {
						var session = accept();
						session.once('exec', function(accept, reject, info) {
							assert.equal(info.command, 'exit');
							var stream = accept();
							stream.stderr.write('FAULT');
							stream.exit(exitCode);
							conn.end();
						});
					});
				});
			});

			mail.connect(function(err, client) {
				mail.exec(client, 'exit', function(err) {
					assert.ok(err === null);
				});
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
'use strict';

var net = require('net'),
	os = require('os'),
	sendmailjs = require('./index');

module.exports = function(opts, cmdLines, callback) {
	var emit = opts.emit || sendmailjs.defConsole,
		intercept = opts.intercept || sendmailjs.defIntercept,
		host = sendmailjs.getHost(opts),
		client = new net.Socket(),
		end_line = '\r\n',
		rules = JSON.parse(JSON.stringify(opts.rules)),
		tasks = ['MAIL FROM', 'RCPT TO', 'DATA', 'QUIT'];
	client.setEncoding('ascii');
	client.on('error', function (err) {
		emit(sendmailjs.STDERR, err.toString());
		callback(err);
	});
	client.connect(opts.port, host, function() {
		emit(sendmailjs.DEBUG, 'ready: ' + host);
	});
	client.on('close', function() {
		emit(sendmailjs.CLOSE, host);
		callback(null, 'CLOSED');
	});
	client.on('data', function(data) {
		emit(sendmailjs.STDOUT, data);
		var arr = data.split(/\s|-/);
		intercept(function(skip) {
			if (!skip) {
				switch (arr[0]) {
					case '220':
						return client.write('EHLO ' + os.hostname() + end_line);
					case '250':
						if (tasks[0] === 'MAIL FROM') {
							client.write('MAIL FROM: ' + rules.from.email + end_line);
							return tasks.shift(0);
						}
						if (tasks[0] === 'RCPT TO') {
							if (rules.to && rules.to.length) {
								client.write('RCPT TO: ' + rules.to[0].email + end_line);
								return rules.to.shift(0);
							} else if (rules.cc && rules.cc.length) {
								client.write('RCPT TO: ' + rules.cc[0].email + end_line);
								return rules.cc.shift(0);
							} else if (rules.bcc && rules.bcc.length) {
								client.write('RCPT TO: ' + rules.bcc[0].email + end_line);
								return rules.bcc.shift(0);
							} else {
								tasks.shift(0);
							}
						}
						if (tasks[0] === 'DATA') {
							client.write('DATA' + end_line);
							return tasks.shift(0);
						} else {
							client.write('QUIT' + end_line);
						}
						break;
					case '354':
						var cmd = [];
						for (var i in cmdLines) {
							cmd.push(cmdLines[i].join(end_line) + end_line);
						}
						cmd.push('--CONTENT_BOUNDARY--');

						client.write(cmd.join('') + end_line + '.' + end_line);
						break;
					case '221':
						return client.destroy();
				}
			}
		}, client, arr[0], data, tasks);
	});
};
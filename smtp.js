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
		index250 = 0;
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
						index250++;
						if (index250 === 1) {
							return client.write('MAIL FROM: dgofman@gmail.com' + end_line);
						}
						if (index250 === 2) {
							return client.write('RCPT TO: dgofman@equinix.com'	+ end_line);
						}
						if (index250 === 3) {
							return client.write('DATA' + end_line);
						}
						client.write('QUIT' + end_line);
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
		}, client, arr[0], data, index250);
	});
};
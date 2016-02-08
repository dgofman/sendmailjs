'use strict';

var dir = process.cwd(),
	sendemail = require(dir + '/index');

var host_name = 'localhost',
	user = 'admin',
	pass ='password';

var mail = sendemail({
	hosts: [host_name],
	port: 22,
	username: user,
	password: pass,
	debug: function(state, data) {
		console.log(state, data);
	}
});

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
	],
	"bcc": [
	],
	"subject": {
		"text": "My Attachment with Logo"
	},
	"contents": [
		{
			"template": __dirname + "/templates/template_logo.html",
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
			"content-type": "text/html",
			"content": "<b>Hello</b> <i>World</i>!"
		}
	],
	"attachments": [
		{
			"name": "company.png",
			"path": __dirname + "/images/company_logo.png",
			"content-type": "image/png",
			"cid": "logo"
		},
		{
			"name": "indigo.png",
			"path": __dirname + "/images/indigo_logo.png",
			"content-type": "image/png"
		}
	]
};

mail.build(rules, function(err, cmdLines, info) {
	if (err) {
		throw err;
	}
	mail.send(cmdLines, function(err, result) {
		if (err) {
			throw err;
		} else {
			console.log(result);
		}
	});
});
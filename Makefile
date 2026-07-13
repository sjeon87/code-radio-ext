.PHONY: zip

zip: background.js icons/* manifest.json offscreen.* popup.*
	zip -r code-radio-ext.zip $^ 

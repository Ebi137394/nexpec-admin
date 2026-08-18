# TFLite controlled test set — provenance manifest

Fetched 2026-08-18 from Wikimedia Commons (API-reported licenses). Used for
literal on-device inference qualification. PRESERVE for owner review.

## weld-defect-crack-1.jpg
- source: https://upload.wikimedia.org/wikipedia/commons/1/19/Cracks_in_weld.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- commons page: https://commons.wikimedia.org/wiki/File%3ACracks%20in%20weld.jpg
- license: CC0
- expected: weld defect — Crack (WDA labels: Crack/fissures-wda)
- sha256: 58e087f6d0a4ae16f0687068977d89ac93632244fba142044f06ed26f470dc15
- dimensions: 1094x893
- mime: image/jpeg
- bytes: 269870

## weld-defect-crack-2.jpg
- source: https://upload.wikimedia.org/wikipedia/commons/7/72/Stress-Corrosion-Cracking-caused-by-weld-stress-01.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- commons page: https://commons.wikimedia.org/wiki/File%3AStress-Corrosion-Cracking-caused-by-weld-stress-01.jpg
- license: CC BY-SA 3.0
- expected: weld defect — Crack (stress-corrosion cracking at weld)
- sha256: 38e1c6b97a17a5d42895e2329ce06790817abdad92155d58731e908302aebd3a
- dimensions: 5545x3697
- mime: image/jpeg
- bytes: 11619701

## corrosion-1.jpg
- source: https://upload.wikimedia.org/wikipedia/commons/6/6e/Rusty_steel_plate.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- commons page: https://commons.wikimedia.org/wiki/File%3ARusty%20steel%20plate.jpg
- license: CC0
- expected: corrosion — rust
- sha256: aab2161f503c2259eeb97e08e60175b88134709a08c44106a94271b9a2799cc8
- dimensions: 4000x3000
- mime: image/jpeg
- bytes: 6463659

## corrosion-2.jpg
- source: https://upload.wikimedia.org/wikipedia/commons/8/83/Corroded_pipe.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- commons page: https://commons.wikimedia.org/wiki/File%3ACorroded%20pipe.jpg
- license: Public domain
- expected: corrosion — corroded-part
- sha256: d8197ec0f27b14f833690b349a3a165e5134a00d738accaad4fb992101068715
- dimensions: 676x1024
- mime: image/jpeg
- bytes: 341324

## clean-weld.jpg
- source: https://upload.wikimedia.org/wikipedia/commons/3/37/TIG_Weld_Flange.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- commons page: https://commons.wikimedia.org/wiki/File%3ATIG%20Weld%20Flange.jpg
- license: CC BY-SA 3.0
- expected: clean/acceptable weld — expect no defect
- sha256: e746213353c1ddaf50dcedafd6de6a0858ddef0a8547bdca8ef6cd3a433d1e52
- dimensions: 1501x837
- mime: image/jpeg
- bytes: 772551

## negative-control-cat.jpg
- source: https://upload.wikimedia.org/wikipedia/commons/c/c7/Tabby_cat_with_blue_eyes-3336579.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original
- commons page: https://commons.wikimedia.org/wiki/File%3ATabby%20cat%20with%20blue%20eyes-3336579.jpg
- license: CC0
- expected: negative control — unrelated subject, expect no detections
- sha256: f91f1e37a23344251f40a7731b28b6612fef6cc37a2f1e7f97d5f6610063248c
- dimensions: 2877x3456
- mime: image/jpeg
- bytes: 2114775

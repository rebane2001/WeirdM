// Cross-Origin-Embedder-Policy: require-corp
// Cross-Origin-Opener-Policy: same-origin

const { createFFmpeg } = FFmpeg;

let ffmpeg = createFFmpeg({ log: true });
let fps = "15";
let crf = "42";
let mode = "trim";

const filePicker = document.getElementById("filepicker");
const startBtn = document.querySelector(".button.start");

const setProgress = (percentage) => {
    if (percentage >= 0) {
        startBtn.innerText = `Processing (${percentage}%)...`;
        startBtn.style.background = `linear-gradient(to right, #2d7d46 ${percentage - 1}%, #4f545c ${percentage}%, #4f545c)`;
    } else {
        startBtn.style.background = null;
    }
}

const recycleFFmpeg = async () => {
    let files = [];
    files.push(['input.avi', ffmpeg.FS('readFile', 'input.avi')]);
    ffmpeg.FS('unlink', 'input.avi')
    let i = 0;
    while (true) {
        i++;
        const fn = i.toString().padStart(6, '0') + '.png';
        try {
            files.push([fn, ffmpeg.FS('readFile', fn)]);
            ffmpeg.FS('unlink', fn);
        } catch {
            break;
        }
    }
    i = 0;
    while (true) {
        const fn = i.toString() + '.webm';
        try {
            files.push([fn, ffmpeg.FS('readFile', fn)]);
            ffmpeg.FS('unlink', fn);
        } catch {
            break;
        }
        i++;
    }
    try {
        ffmpeg.exit();
    } catch {}
    ffmpeg = createFFmpeg({ log: true });
    if (!ffmpeg.isLoaded()) await ffmpeg.load();
    for (i = 0; i < files.length; ++i) {
        ffmpeg.FS('writeFile', files[i][0], files[i][1]);
        files[i][1] = null;
    }
};

const makeWebmPart = async (inArgs, webmCount) => {
    let concat = "";
    inArgs.forEach((arg) => {
        concat += `file ${arg}\n`;
    });
    ffmpeg.FS('writeFile', 'concat.txt', Uint8Array.from(concat.split('').map(letter => letter.charCodeAt(0))));
    await ffmpeg.run('-y', '-f', 'concat', '-i', 'concat.txt', '-vf', `settb=AVTB,setpts=N/${fps}/TB,fps=${fps}`, '-pix_fmt', 'yuv420p', '-crf', crf, '-r', fps, webmCount + '.webm');
    /*
    inArgs.forEach((arg) => {
        ffmpeg.FS('unlink', arg);
    });
     */
    // Wipe worker processes every 10 webms to prevent OOM
    if (webmCount % 10 === 0) await recycleFFmpeg();
};

function getRandomResize(frame) {
    if (frame === 1) return "100%x100%";
    const doH = document.getElementById("random-h").checked;
    const doV = document.getElementById("random-v").checked;
    return `${doH ? Math.ceil(Math.random()*100) : 100}%x${doV ? Math.ceil(Math.random()*100) : 100}%`;
}

function getBounceResize(frame) {
    if (frame === 1) return "100%x100%";
    const funcs = {
        none: (s) => 100,
        sin: (s) => Math.ceil((Math.sin(frame*s/Number(fps))+1)*50),
        cos: (s) => Math.ceil((Math.cos(frame*s/Number(fps))+1)*50),
    };
    let h = funcs[document.getElementById("bounce-h-style").value](document.getElementById("bounce-h-speed").value);
    let v = funcs[document.getElementById("bounce-v-style").value](document.getElementById("bounce-v-speed").value);
    return `${h}%x${v}%`;
}

const makeVideo = async (file) => {
    setProgress(0);
    if (!ffmpeg.isLoaded()) await ffmpeg.load();
    setProgress(5);
    ffmpeg.FS('writeFile', 'input.avi', file);

    ffmpeg.setLogger(({ type, message }) => {
        if (type === "fferr" && message.includes(" fps")) {
            fps = message.split(" fps")[0].split(" ").pop();
        }
    });
    await ffmpeg.run('-y', '-i', 'input.avi')
    console.log("Frame rate is " + fps);
    ffmpeg.setLogger(({ type, message }) => {});
    await ffmpeg.run('-y', '-i', 'input.avi', '%06d.png');
    setProgress(10);
    let framesTotal = 0;
    while (true) {
        framesTotal++;
        const fn = framesTotal.toString().padStart(6, '0') + '.png';
        let file;
        try {
            file = ffmpeg.FS('readFile', fn);
        } catch {
            break;
        }
    }

    let lastRes;
    let webmCount = 0;
    let inArgs = [];
    for (let frame = 1; frame < framesTotal; frame++) {
        const fn = frame.toString().padStart(6, '0') + '.png';
        const file = ffmpeg.FS('readFile', fn);

        const args = {
            trim: ["convert", "in.png", "-trim", "-shave", "1x1", "+repage", "-set", "filename:mysize", "%wx%h", "%[filename:mysize]"],
            bounce: ["convert", "in.png", "-resize", getBounceResize(frame), "-set", "filename:mysize", "%wx%h", "%[filename:mysize]"],
            random: ["convert", "in.png", "-resize", getRandomResize(frame), "-set", "filename:mysize", "%wx%h", "%[filename:mysize]"],
        }[mode];
        const out = await Magick.Call([{ 'name': 'in.png', 'content': file }], args);
        const res = out[0].name;
        ffmpeg.FS('writeFile', fn, out[0].buffer);
        if (!lastRes) lastRes = res;
        if (lastRes !== res) {
            // TODO: Make multi-threaded
            await makeWebmPart(inArgs, webmCount);
            webmCount++;
            lastRes = res;
            inArgs = [];
        }
        setProgress(10 + Math.floor(frame/framesTotal*80));
        inArgs.push(fn);
    }
    await makeWebmPart(inArgs, webmCount);
    webmCount++;
    setProgress(90);
    let concat = "";
    for (let i = 0; i < webmCount; i++) {
        concat += `file ${i}.webm\n`;
    }
    ffmpeg.FS('writeFile', 'concat.txt', Uint8Array.from(concat.split('').map(letter => letter.charCodeAt(0))));
    await ffmpeg.run('-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'vid.webm');
    setProgress(95);
    await ffmpeg.run('-y', '-i', 'vid.webm', '-i', 'input.avi', '-c:v', 'copy', '-map', '0:v', '-map', '1:a?', '-metadata', 'title=WeirdM', 'out.webm');
    setProgress(100);
    return ffmpeg.FS('readFile', 'out.webm');

};

const modes = ["bounce", "random", "trim"];
const getMode = () => {
    for (let m of modes) {
        if (document.getElementById(m).checked) return m;
    }
    return "err";
}

// Yes, it's a weird way of doing this, but radio buttons suck
document.onclick = () => {
    for (let m of modes) {
        document.getElementById(`${m}-options`).style.display = document.getElementById(m).checked ? "block" : "none";
    }
}

startBtn.onclick = () => {
    if (!filePicker.files) return alert("Pick a file first!");
    const reader = new FileReader();
    const filename = filePicker.files[0].name.replace(/\.[^/.]+$/, "_weirdm.webm");
    reader.onload = function() {
        const array = new Uint8Array(this.result);
        mode = getMode();
        crf = document.getElementById("crf").value;
        makeVideo(array).then((final) => {
            downloadBlob(final, filename);
            startBtn.disabled = false;
            startBtn.innerText = "Go!";
            setProgress(-1);
            try {
                ffmpeg.exit();
            } catch {}
        });
    }
    reader.readAsArrayBuffer(filePicker.files[0]);
    startBtn.disabled = true;
    startBtn.innerText = "Processing...";
}

// https://stackoverflow.com/a/62176999/2251833
const downloadURL = (data, fileName) => {
    const a = document.createElement('a')
    a.href = data
    a.download = fileName
    document.body.appendChild(a)
    a.style.display = 'none'
    a.click()
    a.remove()
}

const downloadBlob = (data, fileName, mimeType) => {
    const blob = new Blob([data], {
        type: mimeType
    })
    const url = window.URL.createObjectURL(blob)
    downloadURL(url, fileName)
    setTimeout(() => window.URL.revokeObjectURL(url), 1000)
}


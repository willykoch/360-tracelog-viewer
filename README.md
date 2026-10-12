# Web app to view debug log files from the 360° application
Use both with client-side and server-side trace log files. A trace.log file is a binray file of 3,1 Mb in size.

<img width="1516" height="409" alt="image" src="https://github.com/user-attachments/assets/a4265123-bc38-4102-ae88-44623522d770" />

## Privacy: the log file is processed locally, never uploaded

Clicking **Open…** uses the browser's [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) (`showOpenFilePicker`), falling back to a plain `<input type="file">` picker in browsers that don't support it. Either way, the chosen file is read with `file.arrayBuffer()` and parsed entirely client-side in JavaScript (binary decoding, SQL/XML/stack-trace highlighting, filtering, sorting) — the bytes never leave your machine.

The only network call the app makes is a `GET /api/logfile`, which asks the server whether *it* has a demo log file to serve (it generally doesn't — `.log` files are gitignored and never baked into the deployed image). There is no upload endpoint anywhere in the app. Exporting filtered results as CSV/JSON is also done entirely client-side via `Blob`/`URL.createObjectURL`, downloading straight to your machine.

Net effect: nothing about the log file's contents is ever sent to or stored on the server, regardless of where the app is deployed.

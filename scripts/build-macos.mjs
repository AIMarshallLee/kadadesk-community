import{execFile}from'node:child_process';import{promisify}from'node:util';import{mkdir,chmod}from'node:fs/promises';
if(process.platform!=='darwin')throw Error('Compile the native helper on macOS. Cross-platform source checks are not a Mac binary.');
const arch=process.arch==='arm64'?'arm64':'x86_64';await mkdir('desktop-build',{recursive:true});
await promisify(execFile)('xcrun',['swiftc','-parse-as-library','-O','-target',arch+'-apple-macosx14.4','desktop/macos-native.swift','-o','desktop-build/kadadesk-macos'],{timeout:120000,maxBuffer:2000000});
await chmod('desktop-build/kadadesk-macos',0o755);
// 本地文字识别助手（macOS 自带 Vision，离线、不花模型钱）；打包时必须有它。
await promisify(execFile)('xcrun',['swiftc','-O','-target',arch+'-apple-macosx14.4','desktop/mac-vision-ocr.swift','-o','desktop-build/mac-vision-ocr'],{timeout:120000,maxBuffer:2000000});
await chmod('desktop-build/mac-vision-ocr',0o755);console.log('Built native helper for '+arch);

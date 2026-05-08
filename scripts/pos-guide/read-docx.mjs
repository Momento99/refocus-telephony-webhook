import mammoth from 'mammoth';
const result = await mammoth.extractRawText({ path: process.argv[2] });
console.log(result.value);

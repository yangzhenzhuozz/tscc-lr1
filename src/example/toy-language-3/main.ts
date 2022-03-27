import Parser from "./parser.js";
import lexer from './lexrule.js';
import pre_process from './pre-process.js'
import fs from 'fs';
let parser = new Parser();
let source = fs.readFileSync("./src/example/toy-language-3/test.ty", 'utf-8').toString();
lexer.setSource(source);
try {
    lexer.compile();
    console.time("解析源码耗时");
    pre_process(source);
    parser.parse(lexer);
    console.timeEnd("解析源码耗时");
} catch (e: unknown) {
    console.error(`${e}`);
}
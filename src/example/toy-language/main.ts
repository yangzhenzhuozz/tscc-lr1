import Lexical from "../../lexical_analyzer/lexical_analyzer.js";
import Parser from "./parser.js";

let parser = new Parser();
//定义词法的正则规则，所有正则都是sticky的,flag为y
let lex = new Lexical([
    [/\s+/y],
    ["var", /var/y],
    [";", /;/y],
    ["number", /\d+/y, (str) => { return Number(str); }],
    ["id", /[a-zA-Z][a-zA-Z0-9_]*/y, (str) => { return { name: str }; }],
    ["+", /\+/y],
    ["=", /=/y],
]);
//测试用源码
let source =
`
var a;
var b;
var c;
var d;
`;
lex.setSource(source);
if (parser.parse(lex)) {
    console.log(`成功`);
    console.log(new Date());
} else {
    console.error(`失败`);
}

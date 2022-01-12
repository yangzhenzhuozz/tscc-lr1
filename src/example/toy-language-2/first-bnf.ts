import fs from "fs";
import TSCC from "../../tscc/tscc.js";
import { Grammar } from "../../tscc/tscc.js";
import * as auxiliary from "./auxiliary.js";
/**
 * 这是第一次扫描用的BNF，和第二次扫描几乎没有多大区别
 * 因为解析器是从左往右扫描的，在解析某个片段时可能会依赖后续输入，所以第一次扫描有两个任务
 * 1.得到class的Type信息
 * class A{
 * function fun():int{
 * return a+a;
 * }
 * var a:int;
 * }
 * 在解析到return a+a的时候，还不知道a的信息，所以记录类型信息，得到
 * class A{
 * var a:int;
 * var fun():int;
 * }
 * 2.记录closure需要捕获的变量
 * function outer():int{
 * var a:int;
 * a=a*2;
 * function inner():int{
 * a=a+1;
 * return a;
 * }
 * }
 * 因为在解析到a=a*2的时候，还不知道变量a是需要被closure捕获，所以无法生成正确的代码
 */
let grammar: Grammar = {
    userCode: `
    import * as auxiliary from "./auxiliary.js";
    `,
    tokens: ['var', '...', ';', 'id', 'constant_val', '+', '-', '++', '--', '(', ')', '?', '{', '}', '[', ']', ',', ':', 'function', 'class', '=>', 'operator', 'new', '.', 'extends', 'if', 'else', 'do', 'while', 'for', 'switch', 'case', 'default', 'valuetype', 'import', 'as', 'break', 'continue', 'sealed', 'this', 'return'],
    association: [
        { 'right': ['='] },
        { 'right': ['?'] },
        { 'left': ['==', '!='] },
        { 'left': ['||'] },
        { 'left': ['&&'] },
        { 'left': ['!'] },
        { 'nonassoc': ['>', '<', '<=', '>='] },
        { 'left': ['+', '-'] },
        { 'left': ['*', '/'] },
        { 'left': ['++', '--'] },
        { 'nonassoc': ['low_priority_for_array_placeholder'] },
        { 'right': ['['] },
        { 'nonassoc': ['('] },
        { 'left': ['.'] },
        { 'nonassoc': ['low_priority_for_if_stmt'] },//这个符号的优先级小于else
        { 'nonassoc': ['else'] },
    ],
    BNF: [
        { "program:import_stmts createProgramScope program_units": {} },
        {
            "createProgramScope:": {
                action: function (): auxiliary.ProgramScope {
                    let ret = new auxiliary.ProgramScope();
                    return ret;
                }
            }
        },
        { "program_units:program_units W2_0 program_unit": {} },
        { "program_units:": {} },
        { "program_unit:declare ;": {} },
        { "program_unit:cLass_definition": {} },
        { "import_stmts:": {} },
        { "import_stmts:import_stmts import_stmt": {} },
        { "import_stmt:import id as id ;": {} },
        { "cLass_definition:modifier class id extends_declare { createClassScope class_units }": {} },
        {
            "createClassScope:": {
                action: function ($, s): auxiliary.ClassScope {
                    let head = s.slice(-6)[0] as auxiliary.ProgramScope;
                    let id = s.slice(-3)[0] as string;
                    let modifier = s.slice(-5)[0] as "valuetype" | "sealed" | undefined;
                    let classType = new auxiliary.Type(id);//先创建一个临时Type作为描述符
                    if (modifier != undefined) {
                        classType.modifier = modifier;
                    }
                    let ret = new auxiliary.ClassScope(head, classType);
                    return ret;
                }
            }
        },
        { "modifier:": {} },
        {
            "modifier:valuetype": {
                action: function ($, s): string {
                    return "valuetype";
                }
            }
        },
        {
            "modifier:sealed": {
                action: function ($, s): string {
                    return "sealed";
                }
            }
        },
        { "extends_declare:extends basic_type": {} },
        { "extends_declare:": {} },
        { "class_units:class_units W2_0 class_unit": {} },
        { "class_units:": {} },
        { "class_unit:declare ;": {} },
        { "class_unit:operator_overload": {} },
        { "operator_overload:operator + ( parameter ) : type { statements }": {} },
        {
            "declare:var id : type": {
                action: function ($, s) {
                    let head = s.slice(-1)[0] as auxiliary.Scope;
                    let id = $[1] as string;
                    let type = $[3] as auxiliary.Type;
                    head.register(id, type);
                }
            }
        },
        { "declare:function_definition": {} },
        {
            "type:basic_type arr_definition": {
                action: function ($, s): auxiliary.Type {
                    //已经把basic_type的属性继承到arr_definition去了
                    let arr_definition = $[1] as auxiliary.Type;
                    return arr_definition;
                }
            }
        },
        {
            "arr_definition:arr_definition [ ]": {
                action: function ($, s): auxiliary.Type {
                    let arr_definition = $[0] as auxiliary.Type;
                    let ret = new auxiliary.ArrayType(arr_definition);
                    return ret;
                }
            }
        },
        {
            "arr_definition:": {
                action: function ($, s): auxiliary.Type {
                    let basic_type = s.slice(-1)[0] as auxiliary.Type;//从basic_type中得到继承属性
                    return basic_type;
                }
            }
        },
        {
            "basic_type:id": {
                action: function ($, s): auxiliary.Type {
                    let id = $[0] as string;
                    if (auxiliary.baseType.has(id)) {
                        return new auxiliary.Type(id);
                    } else {
                        throw new auxiliary.SemanticException(`未识别的类型${id}`);
                    }
                }
            }
        },
        {
            "type:( function_parameter_types ) => type": {
                action: function ($, s): auxiliary.Type {
                    let function_parameter_types = $[1] as auxiliary.Type[];
                    let ret_type = $[4] as auxiliary.Type;
                    let ret = new auxiliary.FunctionType(ret_type);
                    let index = 0;
                    for (let type of function_parameter_types) {
                        ret.registerParameter(`$${index++}`, type);
                    }
                    return ret;
                }
            }
        },
        {
            "function_parameter_types:": {
                action: function ($, s): auxiliary.Type[] {
                    return [];//返回一个空数组，没有任何参数声明
                }
            }
        },
        {
            "function_parameter_types:function_parameter_type_list": {
                action: function ($, s): auxiliary.Type[] {
                    return $[0] as auxiliary.Type[];
                }
            }
        },
        {
            "function_parameter_type_list:function_parameter_type_list , type": {
                action: function ($, s): auxiliary.Type[] {
                    let function_parameter_type_list_0 = $[0] as auxiliary.Type[];
                    let type = $[2] as auxiliary.Type;
                    function_parameter_type_list_0.push(type);
                    return function_parameter_type_list_0;
                }
            }
        },
        {
            "function_parameter_type_list:type": {
                action: function ($, s): auxiliary.Type[] {
                    return [$[0] as auxiliary.Type];
                }
            }
        },
        { "function_definition:function id ( parameters ) : type { createFunctionScope statements }": {} },
        {
            "createFunctionScope:": {
                action: function ($, s): auxiliary.FunctionScope {
                    let head = s.slice(-9)[0] as auxiliary.ProgramScope | auxiliary.ClassScope | auxiliary.FunctionScope;
                    let id = s.slice(-7)[0] as string;
                    let ret_type = s.slice(-2)[0] as auxiliary.Type;
                    let parameters = s.slice(-5)[0] as { name: string, type: auxiliary.Type }[];
                    let functionType = new auxiliary.FunctionType(ret_type);
                    for (let parameter of parameters) {
                        functionType.registerParameter(parameter.name, parameter.type);
                    }
                    if (head instanceof auxiliary.ClassScope) {//如果是在class中定义的函数，则进行注册
                        head.register(id, functionType);
                    }
                    let ret: auxiliary.FunctionScope;
                    debugger
                    if (head instanceof auxiliary.ProgramScope) {//如果不是在class中定义的函数
                        ret = new auxiliary.FunctionScope(head, undefined, undefined, functionType);
                    } else if (head instanceof auxiliary.ClassScope) {
                        ret = new auxiliary.FunctionScope(head.programScope, head, undefined, functionType);
                    } else {  // head instanceof auxiliary.FunctionScope
                        ret = new auxiliary.FunctionScope(head.programScope, head.classScope, head, functionType);
                    }
                    return ret;
                }
            }
        },
        {
            "parameters:parameter_list": {
                action: function ($, s): { name: string, type: auxiliary.Type }[] {
                    return $[0] as { name: string, type: auxiliary.Type }[];
                }
            }
        },
        {
            "parameters:varible_argument": {
                action: function ($, s): { name: string, type: auxiliary.Type }[] {
                    return $[0] as { name: string, type: auxiliary.Type }[];
                }
            }
        },
        {
            "parameters:parameter_list , varible_argument": {
                action: function ($, s): { name: string, type: auxiliary.Type }[] {
                    let parameter_list = $[0] as { name: string, type: auxiliary.Type }[];
                    let varible_argument = $[2] as { name: string, type: auxiliary.Type }[];
                    return parameter_list.concat(varible_argument);
                }
            }
        },
        {
            "parameters:": {
                action: function ($, s): { name: string, type: auxiliary.Type }[] {
                    return [];
                }
            }
        },
        {
            "parameter_list:parameter_list , parameter": {
                action: function ($, s): { name: string, type: auxiliary.Type }[] {
                    let parameter_list = $[0] as { name: string, type: auxiliary.Type }[];
                    let parameter = $[2] as { name: string, type: auxiliary.Type };
                    parameter_list.push(parameter);
                    return parameter_list;
                }
            }
        },
        {
            "parameter_list:parameter": {
                action: function ($, s): { name: string, type: auxiliary.Type }[] {
                    return [$[0] as { name: string, type: auxiliary.Type }];
                }
            }
        },
        {
            "parameter:id : type": {
                action: function ($, s): { name: string, type: auxiliary.Type } {
                    let id = $[0] as string;
                    let type = $[2] as auxiliary.Type;
                    return { name: id, type: type };
                }
            }
        },
        {
            "varible_argument: ... id : type": {
                action: function ($, s): { name: string, type: auxiliary.Type }[] {
                    let id = $[1] as string;
                    let type = $[3] as auxiliary.Type;
                    let ret_type = new auxiliary.ArrayType(type);
                    return [{ name: id, type: ret_type }];
                }
            }
        },
        { "statement:declare ;": {} },
        { "statement:return object ;": {} },
        { "statement:return ;": {} },
        { "statement:if ( object ) statement": { priority: "low_priority_for_if_stmt" } },
        { "statement:if ( object ) statement ELSE statement": {} },
        { "ELSE:else": {} },
        { "statement:lable_def do statement while ( object ) ;": {} },
        { "statement:lable_def while ( object ) statement": {} },
        { "statement:lable_def for ( for_init ; for_condition ; for_step ) statement": {} },
        { "for_init:": {} },
        { "for_init:declare": {} },
        { "for_init:object": {} },
        { "for_condition:": {} },
        { "for_condition:object": {} },
        { "for_step:": {} },
        { "for_step:object": {} },
        { "statement:block": { action: ($, s) => $[0] } },
        { "statement:break lable_use ;": {} },
        { "statement:continue lable_use ;": {} },
        { "statement:switch ( object ) { switch_bodys }": {} },
        { "statement:object ;": {} },
        { "lable_use:": {} },
        { "lable_use:id": {} },
        { "lable_def:": {} },
        { "lable_def:id :": {} },
        { "switch_bodys:": {} },
        { "switch_bodys:switch_bodys switch_body": {} },
        { "switch_body:case constant_val : statement": {} },
        { "switch_body:default : statement": {} },
        { "block:{ statements }": {} },
        { "statements:": {} },
        { "statements:statements W2_0 statement": {} },
        {
            "object:id": {
                //函数能且仅能在这里取变量
                action: function ($, s) {
                    let head = s.slice(-1)[0] as auxiliary.FunctionScope;
                    let id = $[0] as string;
                    head.closureCheck(id);//闭包变量检查
                }
            }
        },
        { "object:constant_val": {} },
        { "object:object ( arguments )": {} },
        { "object:( parameters ) => { statements }": {} },//lambda
        { "object:( object )": {} },
        { "object:object . id": {} },
        { "object:object = object": {} },
        { "object:object + object": {} },
        { "object:object - object": {} },
        { "object:object * object": {} },
        { "object:object / object": {} },
        { "object:object < object": {} },
        { "object:object <= object": {} },
        { "object:object > object": {} },
        { "object:object >= object": {} },
        { "object:object == object": {} },
        { "object:object || object": {} },
        { "object:object && object": {} },
        { "object:object ? object : object": { priority: "?" } },
        { "object:object ++": {} },
        { "object:object --": {} },
        { "object:new { anonymous_stmts }": {} },//匿名类，类似C#而不是java
        { "object:new basic_type ( arguments )": {} },
        { "object:new basic_type array_init_list": {} },
        { "object:object [ object ]": {} },
        { "object:this": {} },
        { "array_init_list:array_inits array_placeholder": {} },
        { "array_inits:array_inits [ object ]": {} },
        { "array_inits:[ object ]": {} },
        { "array_placeholder:array_placeholder_list": { priority: "low_priority_for_array_placeholder" } },//遇到方括号一律选择移入
        { "array_placeholder:": { priority: "low_priority_for_array_placeholder" } },
        { "array_placeholder_list:array_placeholder_list [ ]": {} },
        { "array_placeholder_list:[ ]": { priority: "low_priority_for_array_placeholder" } },
        { "anonymous_stmts:anonymous_stmts anonymous_stmt": {} },
        { "anonymous_stmts:": {} },
        { "anonymous_stmt:id = object ;": {} },
        { "arguments:argument_list": {} },
        { "arguments:": {} },
        { "argument_list:argument": {} },
        { "argument_list:argument_list , argument": {} },
        { "argument:object": {} },
        {
            "W2_0:": {
                action: function ($, s) {
                    return s.slice(-2)[0];
                }
            }
        }
    ]
};
let tscc = new TSCC(grammar, { language: "zh-cn", debug: false });
let str = tscc.generate();//构造编译器代码
if (str != null) {//如果构造成功则生成编编译器代码
    console.log(`成功`);
    fs.writeFileSync('./src/example/toy-language-2/parser-1.ts', str);
} else {
    console.log(`失败`);
}
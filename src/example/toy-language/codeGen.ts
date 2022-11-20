import { globalVariable } from './constant.js';
import { Scope, BlockScope, ClassScope, ProgramScope } from './scope.js';
import { IR, Symbol, symbols, addRelocationTable, typeRelocationTable, stackFrameMap, stackFrameRelocationTable } from './ir.js'
import { FunctionSignWithArgumentAndRetType } from './lib.js';
let program: Program;
let programScope: ProgramScope;
let globalFunctionIndex = 0;
function backPatch(list: IR[], target: IR) {
    for (let ir of list) {
        ir.operand = target.index - ir.index;
    }
}
function merge(a: IR[], b: IR[]) {
    return a.concat(b);
}
/**
 * 
 * @param scope 
 * @param node 
 * @param label 
 * @param inFunction 是否在函数中，这个参数决定了this的取值方式
 * @param argumentMap 函数参数的补偿和size，只用于loadArgument节点
 * @param boolNot 布尔运算的时候是否要取反向生成操作符，因为'||'和'&&'的left运算不同，默认取反可以节约指令
 * @returns 
 */
function nodeRecursion(scope: Scope, node: ASTNode, label: string[], inFunction: boolean, argumentMap: { offset: number, size: number }[], frameLevel: number, boolNot: boolean = true): { startIR: IR, endIR: IR, truelist: IR[], falselist: IR[], jmpToFunctionEnd?: IR[] } {
    if (node['_program'] != undefined) {
        let ir = new IR('p_load');
        return { startIR: ir, endIR: ir, truelist: [], falselist: [] };
    }
    else if (node['accessField'] != undefined) {
        let irs = nodeRecursion(scope, node['accessField']!.obj, label, inFunction, argumentMap, frameLevel, boolNot);
        let type = node['accessField']!.obj.type!;
        let baseScope: Scope;
        if (type.ProgramType != undefined) {
            baseScope = programScope;
        } else if (type.PlainType != undefined) {
            baseScope = programScope.getClassScope(type.PlainType.name);
        } else {
            throw `其他类型暂时不能访问成员`;
        }
        let prop = baseScope.getPropOffset(node['accessField']!.field);
        let ir = new IR('getfield', prop.offset, prop.size);
        return { startIR: irs.startIR, endIR: ir, truelist: [], falselist: [] };
    }
    else if (node['immediate'] != undefined) {
        if (isNaN(Number(node["immediate"]!.primiviteValue))) {
            throw `暂时不支持非数字的initAST`;
        } else {
            let ir = new IR('const_i32_load', Number(node["immediate"]!.primiviteValue));
            return { startIR: ir, endIR: ir, truelist: [], falselist: [] };
        }
    }
    else if (node['+'] != undefined) {
        let left = nodeRecursion(scope, node['+']!.leftChild, label, inFunction, argumentMap, frameLevel, boolNot);
        let right = nodeRecursion(scope, node['+']!.rightChild, label, inFunction, argumentMap, frameLevel, boolNot);
        let opIR: IR;
        if (node['+']!.leftChild.type?.PlainType?.name == 'int' && node['+']!.rightChild.type?.PlainType?.name == 'int') {
            opIR = new IR('i32_add');
        } else {
            throw `暂为支持的+操作`;
        }
        return { startIR: left.startIR, endIR: opIR, truelist: [], falselist: [] };
    }
    else if (node['<'] != undefined) {
        let left = nodeRecursion(scope, node['<']!.leftChild, label, inFunction, argumentMap, frameLevel, boolNot);
        let right = nodeRecursion(scope, node['<']!.rightChild, label, inFunction, argumentMap, frameLevel, boolNot);
        let opIR: IR;
        let tureList: IR[] = [];
        let falseList: IR[] = [];
        if (node['<']!.leftChild.type?.PlainType?.name == 'int' && node['<']!.rightChild.type?.PlainType?.name == 'int') {
            if (boolNot) {
                opIR = new IR('i_if_ge');
                falseList.push(opIR)
            } else {
                opIR = new IR('i_if_lt');
                tureList.push(opIR)
            }
        } else {
            throw `暂为支持的+操作`;
        }
        return { startIR: left.startIR, endIR: opIR, truelist: tureList, falselist: falseList };
    }
    else if (node['ternary'] != undefined) {
        let condition = node['ternary']!.condition;
        let a = nodeRecursion(scope, condition, label, inFunction, argumentMap, frameLevel, boolNot);
        if (a.truelist.length == 0 && a.falselist.length == 0) {//如果bool值不是通过布尔运算得到的，则必须为其插入一个判断指令
            let ir = new IR('i_if_ne');
            a.falselist.push(ir);
        }
        let b = nodeRecursion(scope, node['ternary']!.obj1, label, inFunction, argumentMap, frameLevel, boolNot);
        let ir = new IR('jmp');
        let c = nodeRecursion(scope, node['ternary']!.obj2, label, inFunction, argumentMap, frameLevel, boolNot);
        ir.operand = c.endIR.index - ir.index + 1;
        backPatch(a.truelist, b.startIR);//回填trueList
        backPatch(a.falselist, c.startIR);//回填falseList
        return { startIR: a.startIR, endIR: c.endIR, truelist: [], falselist: [] };
    } else if (node['_this'] != undefined) {
        if (inFunction) {
            let loadFunctionBase = new IR('v_load', 0, globalVariable.pointSize);
            let loadThis = new IR('v_load', 0);//函数中的this需要load两次才能拿到正确的this
            return { startIR: loadFunctionBase, endIR: loadThis, truelist: [], falselist: [] };;
        } else {
            let ir = new IR('v_load', 0, globalVariable.pointSize);
            return { startIR: ir, endIR: ir, truelist: [], falselist: [] };;
        }
    } else if (node['def'] != undefined) {
        let blockScope = (scope as BlockScope);//def节点是block专属
        let name = Object.keys(node['def'])[0];
        blockScope.setProp(name, node['def'][name]);
        let description = blockScope.getPropOffset(name);
        if (node['def'][name].initAST != undefined) {
            let nr = nodeRecursion(blockScope, node['def'][name].initAST!, label, inFunction, argumentMap, frameLevel, boolNot);
            if (nr.truelist.length > 0 || nr.falselist.length > 0) {
                let trueIR = new IR('const_i8_load', 1);
                new IR('jmp', 2);
                let falseIR = new IR('const_i8_load', 0);
                backPatch(nr.truelist, trueIR);//回填true
                backPatch(nr.falselist, falseIR);//回填false
            }
            let assginment = new IR('v_store', description.offset, description.size);
            return { startIR: nr.startIR, endIR: assginment, truelist: [], falselist: [] };
        } else if (node['def'][name].type?.FunctionType && node['def'][name].type?.FunctionType?.body) {//如果是函数定义则生成函数
            let blockScope = new BlockScope(scope, node['def'][name].type?.FunctionType, node['def'][name].type?.FunctionType?.body!, { program });
            let functionWrapName = functionGen(blockScope, node['def'][name].type?.FunctionType!);
            let functionWrapScpoe = programScope.getClassScope(functionWrapName);
            let this_type = functionWrapScpoe.getProp(`@this`).prop.type!;
            let this_desc = functionWrapScpoe.getPropOffset(`@this`);
            let startIR = new IR('new', undefined, undefined, functionWrapName);
            typeRelocationTable.push({ sym: functionWrapName, ir: startIR });
            new IR('dup', globalVariable.pointSize);//复制一份，用来给init使用
            let call = new IR('abs_call', undefined, undefined, `${functionWrapName}_init`);//执行调用
            addRelocationTable.push({ sym: `${functionWrapName}_init`, ir: call });
            if (blockScope.classScope != undefined) {
                //如果是在class中定义的函数，设置this
                new IR('dup', globalVariable.pointSize);//复制一份，用来设置this
                new IR('v_load', 0, globalVariable.pointSize);//读取this
                putfield(this_type, this_desc.offset, [], []);//设置this
            }
            let endIR = new IR('v_store', description.offset, description.size);
            let capture = node['def'][name].type!.FunctionType!.capture;
            for (let capturedName in capture) {//设置捕获变量
                let captureDesc = blockScope.getPropOffset(capturedName);//当前scope被捕获对象的描述符
                let captureType = blockScope.getProp(capturedName).prop.type!;//被捕获对象的类型(已经是包裹类)
                let targetDesc = functionWrapScpoe.getPropOffset(capturedName);//捕获对象在被包裹类中的描述符
                new IR('v_load', description.offset, description.size);//读取函数对象的指针
                new IR('v_load', captureDesc.offset, captureDesc.size);//读取被捕获变量
                // 有问题
                endIR = putfield(captureType, targetDesc.offset, [], []);
            }
            return { startIR: startIR, endIR: endIR, truelist: [], falselist: [] };

        } else {
            //如果没有init命令则使用defalut
            return defalutValue(node['def'][name].type!);
        }
    }
    else if (node['loadArgument'] != undefined) {
        let argDesc = argumentMap![node['loadArgument'].index];
        let ir = new IR('v_load', -argDesc.offset, argDesc.size);
        return { startIR: ir, endIR: ir, truelist: [], falselist: [] };
    }
    else if (node['load'] != undefined) {
        let desc = (scope as BlockScope).getPropOffset(node['load']);
        let ir = new IR('v_load', desc.offset, desc.size);
        return { startIR: ir, endIR: ir, truelist: [], falselist: [] };
    }
    else if (node['_new'] != undefined) {
        let ir = new IR('new', undefined, undefined, node['_new'].type.PlainType.name);
        typeRelocationTable.push({ sym: node['_new'].type.PlainType.name, ir: ir });
        let call = new IR('abs_call', undefined, undefined, `${node['_new'].type.PlainType.name}_init`);
        addRelocationTable.push({ sym: `${node['_new'].type.PlainType.name}_init`, ir: call });
        let argTypes: TypeUsed[] = [];
        let args = node['_new']._arguments;
        for (let i = args.length - 1; i >= 0; i--) {
            argTypes.push(args[args.length - 1 - i].type!);//顺序获取type
            nodeRecursion(scope, args[i], label, inFunction, argumentMap, frameLevel, boolNot);//逆序压参
        }
        let sign = `@constructor:${node['_new'].type.PlainType.name}  ${FunctionSignWithArgumentAndRetType(argTypes, { PlainType: { name: 'void' } })}`;//构造函数签名
        call = new IR('abs_call', undefined, undefined, sign);//执行调用
        addRelocationTable.push({ sym: sign, ir: call });
        return { startIR: ir, endIR: call, truelist: [], falselist: [] };
    }
    else if (node['||'] != undefined) {
        let left = nodeRecursion(scope, node['||'].leftChild, label, inFunction, argumentMap, frameLevel, false);
        if (left.falselist.length == 0 && left.truelist.length == 0) {//如果没有回填，则为其创建回填指令
            left.truelist.push(new IR('i_if_eq'));
        }
        let right = nodeRecursion(scope, node['||'].rightChild, label, inFunction, argumentMap, frameLevel, boolNot);
        let endIR: IR;
        if (right.falselist.length == 0 && right.truelist.length == 0) {//如果没有回填，则为其创建回填指令
            endIR = new IR('i_if_ne')
            right.falselist.push(endIR);
        } else {
            endIR = right.endIR;
        }
        backPatch(left.falselist, right.startIR);
        let truelist = merge(left.truelist, right.truelist);
        return { startIR: left.startIR, endIR: endIR, truelist: truelist, falselist: right.falselist };
    }
    else if (node['&&'] != undefined) {
        let left = nodeRecursion(scope, node['&&'].leftChild, label, inFunction, argumentMap, frameLevel, boolNot);
        if (left.falselist.length == 0 && left.truelist.length == 0) {//如果没有回填，则为其创建回填指令
            left.falselist.push(new IR('i_if_ne'));
        }
        let right = nodeRecursion(scope, node['&&'].rightChild, label, inFunction, argumentMap, frameLevel, boolNot);
        let endIR: IR;
        if (right.falselist.length == 0 && right.truelist.length == 0) {//如果没有回填，则为其创建回填指令
            endIR = new IR('i_if_ne');
            right.falselist.push(endIR);
        } else {
            endIR = right.endIR;
        }
        backPatch(left.truelist, right.startIR);
        let falselist = merge(left.falselist, right.falselist);
        return { startIR: left.startIR, endIR: endIR, truelist: right.truelist, falselist: falselist };
    }
    else if (node['ifElseStmt'] != undefined) {
        let condition = nodeRecursion(scope, node['ifElseStmt'].condition, label, inFunction, argumentMap, frameLevel, boolNot);
        if (condition.truelist.length == 0 && condition.falselist.length == 0) {//如果bool值不是通过布尔运算得到的，则必须为其插入一个判断指令
            let ir = new IR('i_if_ne');
            condition.falselist.push(ir);
        }
        let block1Ret = BlockScan(new BlockScope(scope, undefined, node['ifElseStmt'].stmt1, { program }), label, argumentMap, frameLevel + 1);
        let jmp = new IR('jmp');
        let block2Ret = BlockScan(new BlockScope(scope, undefined, node['ifElseStmt'].stmt2, { program }), label, argumentMap, frameLevel + 1);
        let nop = new IR('nop');
        jmp.operand = nop.index - jmp.index;
        backPatch(condition.truelist, block1Ret.startIR);
        backPatch(condition.falselist, block2Ret.startIR);
        return { startIR: condition.startIR, endIR: nop, truelist: [], falselist: [], jmpToFunctionEnd: block1Ret.jmpToFunctionEnd.concat(block2Ret.jmpToFunctionEnd) };
    }
    else if (node['ifStmt'] != undefined) {
        let condition = nodeRecursion(scope, node['ifStmt'].condition, label, inFunction, argumentMap, frameLevel, boolNot);
        if (condition.truelist.length == 0 && condition.falselist.length == 0) {//如果bool值不是通过布尔运算得到的，则必须为其插入一个判断指令
            let ir = new IR('i_if_ne');
            condition.falselist.push(ir);
        }
        let blockRet = BlockScan(new BlockScope(scope, undefined, node['ifStmt'].stmt, { program }), label, argumentMap, frameLevel + 1);
        let nop = new IR('nop');
        backPatch(condition.truelist, blockRet.startIR);
        backPatch(condition.falselist, nop);
        return { startIR: condition.startIR, endIR: nop, truelist: [], falselist: [], jmpToFunctionEnd: blockRet.jmpToFunctionEnd };
    }
    else if (node['ret'] != undefined) {
        let startIR: IR;
        let jmpToFunctionEnd: IR[] = [];
        if (node['ret'] != '') {
            let ret = nodeRecursion(scope, node['ret'], label, inFunction, argumentMap, frameLevel, boolNot);
            startIR = ret.startIR;
            if (ret.truelist.length > 0 || ret.falselist.length > 0) {//如果需要回填，则说明是一个bool表达式
                let trueIR = new IR('const_i8_load', 1);
                new IR('jmp', 2);
                let falseIR = new IR('const_i8_load', 0);
                backPatch(ret.truelist, trueIR);//回填true
                backPatch(ret.falselist, falseIR);//回填false
            }
            new IR('pop_stack_map', frameLevel);
            let jmp = new IR('jmp');
            jmpToFunctionEnd.push(jmp);
        } else {//无条件返回语句
            startIR = new IR('jmp');
            new IR('pop_stack_map', frameLevel);
            jmpToFunctionEnd.push(startIR);
        }
        return { startIR: startIR, endIR: jmpToFunctionEnd[0], truelist: [], falselist: [], jmpToFunctionEnd: jmpToFunctionEnd };
    }
    else { throw `还没支持的AST类型` };
}
function putfield(type: TypeUsed, offset: number, truelist: IR[], falselist: IR[]): IR {
    if (truelist.length > 0 || falselist.length > 0) {
        let trueIR = new IR('const_i8_load', 1);
        new IR('jmp', 2);
        let falseIR = new IR('const_i8_load', 0);
        backPatch(truelist, trueIR);//回填true
        backPatch(falselist, falseIR);//回填false
    }
    let endIR: IR;
    if (type.PlainType && program.definedType[type.PlainType.name].modifier == 'valuetype') {
        endIR = new IR('putfield', offset, program.definedType[type.PlainType.name].size);
    } else {//非值类型的copy统统按照指针处理
        endIR = new IR('putfield', offset, globalVariable.pointSize);
    }
    return endIR;
}
function defalutValue(type: TypeUsed): { startIR: IR, endIR: IR, truelist: IR[], falselist: IR[] } {
    // throw `unimplemented`
    return {} as any;
}
function BlockScan(blockScope: BlockScope, label: string[], argumentMap: { offset: number, size: number }[], frameLevel: number): { startIR: IR, jmpToFunctionEnd: IR[] } {
    let stackFrameMapIndex = globalVariable.stackFrameMapIndex++;
    let push_stack_map = new IR('push_stack_map', undefined, undefined, `@StackFrame_${stackFrameMapIndex}`);
    console.error('函数return的时候需要弹出正确的frame数量');
    stackFrameRelocationTable.push({ sym: `@StackFrame_${stackFrameMapIndex}`, ir: push_stack_map });
    let ret: { startIR: IR, jmpToFunctionEnd: IR[] } = { startIR: push_stack_map, jmpToFunctionEnd: [] };//所有返回指令
    for (let i = 0; i < blockScope.block!.body.length; i++) {
        let nodeOrBlock = blockScope.block!.body[i];
        if (nodeOrBlock.desc == 'ASTNode') {
            let nodeRet = nodeRecursion(blockScope, nodeOrBlock as ASTNode, label, true, argumentMap, frameLevel);
            if (nodeRet.jmpToFunctionEnd) {
                ret.jmpToFunctionEnd = ret.jmpToFunctionEnd.concat(nodeRet.jmpToFunctionEnd);
            }
        } else {
            let block = nodeOrBlock as Block;
            let jmpToFunctionEnd = BlockScan(new BlockScope(blockScope, undefined, block, { program }), label, argumentMap, frameLevel + 1).jmpToFunctionEnd;
            for (let ir of jmpToFunctionEnd) {
                ret.jmpToFunctionEnd.push(ir);
            }
        }
    }
    let lastNode = blockScope.block!.body[blockScope.block!.body.length - 1];
    /**
     * 如果block的最后一个AST是ret,则pop_stack_map已经由这个AST生成了
     * 否则弹出一个帧(因为每个block结束只需要弹出自己的帧,ret节点改变了处理流程，所以自己控制弹出帧的数量)
     */
    if (lastNode.desc != 'ASTNode' && (lastNode as ASTNode).ret == undefined) {
        new IR('pop_stack_map', 1);
    }
    //到这里scope的所有def已经解析完毕，可以保存了
    let stackFrame: { name: string, type: TypeUsed }[] = [];
    for (let k in blockScope.property) {
        stackFrame.push({ name: k, type: blockScope.getProp(k).prop.type! });
    }
    stackFrameMap[`@StackFrame_${stackFrameMapIndex}`] = { baseOffset: blockScope.baseOffset, frame: stackFrame };
    return ret;
}
function propSize(type: TypeUsed): number {
    if (type.PlainType != undefined) {
        if (program.definedType[type.PlainType.name].modifier == 'valuetype') {
            return program.definedType[type.PlainType.name].size!;
        } else {
            return globalVariable.pointSize;
        }
    } else {
        return globalVariable.pointSize;
    }
}
function functionGen(blockScope: BlockScope, fun: FunctionType): string {
    let lastSymbol = Symbol.getSymbol();//类似回溯，保留现场
    let argumentMap: { offset: number, size: number }[] = [];
    let argOffset = 0;
    for (let argumentName in fun._arguments) {
        let size = propSize(fun._arguments[argumentName].type!);
        argOffset += size;
        argumentMap.push({ offset: argOffset, size: size });
    }
    let functionIndex = globalFunctionIndex++;
    let functionWrapName = `@functionWrap_${functionIndex}`;
    let wrapInitSymbol = new Symbol(`${`${functionWrapName}_init`}`);
    Symbol.setSymbol(wrapInitSymbol);
    let property: VariableDescriptor = {};
    //为函数对象创建两个基本值
    property['@this'] = {
        variable: 'val',
        type: {
            PlainType: { name: '@point' }
        }
    };
    property['@exec'] = {
        variable: 'val',
        type: {
            PlainType: { name: '@point' }
        }
    };
    for (let c in fun.capture) {
        property[c] = {
            variable: 'val',
            type: blockScope.getProp(c).prop.type//向上查找闭包包裹类的类型
        };
    }
    //注册函数容器
    let typeIndex = globalVariable.typeIndex++;
    program.definedType[functionWrapName] = {
        operatorOverload: {},
        _constructor: {},
        property: property,
        size: globalVariable.pointSize + Object.keys(fun.capture).length * globalVariable.pointSize,
        typeIndex: typeIndex
    };
    programScope.registerClassForCapture(functionWrapName);//注册类型
    new IR('dup', undefined, globalVariable.pointSize);//复制new出来的function对象
    let functionAdd = new IR('const_i64_load', undefined, undefined, `@function_${functionIndex}`);
    addRelocationTable.push({ sym: `@function_${functionIndex}`, ir: functionAdd });//等待编译完成后重定向
    let functionWrapScpoe = programScope.getClassScope(functionWrapName);
    let exec_type = functionWrapScpoe.getProp(`@exec`).prop.type!;
    let exec_desc = functionWrapScpoe.getPropOffset(`@exec`);
    putfield(exec_type, exec_desc.offset, [], []);//设置exec
    new IR('ret', globalVariable.pointSize);//classInit返回
    //函数对象init只初始化@exec字段，其他地方由创建者完成(program、class、block)
    let functionSymbol = new Symbol(`@function_${functionIndex}`);
    Symbol.setSymbol(functionSymbol);
    let jmpToFunctionEnd = BlockScan(blockScope, [], argumentMap, 1).jmpToFunctionEnd;
    let retIR = new IR('ret', argOffset);
    for (let ir of jmpToFunctionEnd) {
        ir.operand = retIR.index - ir.index;//处理所有ret jmp
    }
    Symbol.setSymbol(lastSymbol);//回退
    return functionWrapName;
}
function classScan(classScope: ClassScope) {
    let lastSymbol = Symbol.getSymbol();//类似回溯，保留现场
    let symbol = new Symbol(`${classScope.className}_init`);
    Symbol.setSymbol(symbol);
    //扫描property
    for (let propName of classScope.getPropNames()) {
        let prop = classScope.getProp(propName).prop;
        let description = classScope.getPropOffset(propName);
        if (prop.initAST != undefined) {
            new IR('v_load', 0, globalVariable.pointSize);
            let nr = nodeRecursion(classScope, prop.initAST, [], false, [], 1);
            putfield(prop.type!, description.offset, nr.truelist, nr.falselist);
        } else if (prop.type?.FunctionType && prop.type?.FunctionType.body) {
            let blockScope = new BlockScope(programScope, prop.type?.FunctionType, prop.type?.FunctionType.body!, { program });
            let functionWrapName = functionGen(blockScope, prop.type?.FunctionType);
            let functionWrapScpoe = programScope.getClassScope(functionWrapName);
            let this_type = functionWrapScpoe.getProp(`@this`).prop.type!;
            let this_desc = functionWrapScpoe.getPropOffset(`@this`);
            new IR('v_load', 0, globalVariable.pointSize);
            let newIR = new IR('new', undefined, undefined, functionWrapName);
            typeRelocationTable.push({ sym: functionWrapName, ir: newIR });
            new IR('dup', globalVariable.pointSize);//复制一份，用来给init使用
            let call = new IR('abs_call', undefined, undefined, `${functionWrapName}_init`);//执行调用
            new IR('dup', globalVariable.pointSize);//复制一份，用来设置this
            new IR('v_load', 0, globalVariable.pointSize);//读取this
            putfield(this_type, this_desc.offset, [], []);//设置this
            putfield(prop.type, description.offset, [], []);//设置函数对象
            addRelocationTable.push({ sym: `${functionWrapName}_init`, ir: call });
        } else {
            //使用default
            defalutValue(prop.type!);
        }
    }
    new IR('ret', globalVariable.pointSize);//classInit返回
    Symbol.setSymbol(lastSymbol);//回退
}
export default function programScan(primitiveProgram: Program) {
    program = primitiveProgram;
    programScope = new ProgramScope(program, { program: program });
    program.definedType['@point'] = {
        modifier: 'valuetype',
        property: {},
        operatorOverload: {},
        _constructor: {},
        size: globalVariable.pointSize
    };
    programScope.registerClassForCapture('@point');//注册point类型


    let symbol = new Symbol('program_init');
    Symbol.setSymbol(symbol);

    //扫描property
    for (let variableName in program.property) {
        var prop = program.property[variableName];
        let description = programScope.getPropOffset(variableName);
        if (prop.initAST != undefined) {
            new IR('p_load');
            let nr = nodeRecursion(programScope, prop.initAST, [], false, [], 1);
            putfield(prop.type!, description.offset, nr.truelist, nr.falselist);
        } else if (prop.type?.FunctionType && prop.type?.FunctionType.body) {//如果是函数定义则生成函数
            let blockScope = new BlockScope(programScope, prop.type?.FunctionType, prop.type?.FunctionType.body!, { program });
            let functionWrapName = functionGen(blockScope, prop.type?.FunctionType);
            new IR('p_load');
            let newIR = new IR('new', undefined, undefined, functionWrapName);//创建函数包裹类
            typeRelocationTable.push({ sym: functionWrapName, ir: newIR });
            new IR('dup', globalVariable.pointSize);//复制一份，用来给init使用
            let call = new IR('abs_call', undefined, undefined, `${functionWrapName}_init`);//执行调用
            putfield(prop.type, description.offset, [], []);
            addRelocationTable.push({ sym: `${functionWrapName}_init`, ir: call });
        } else {
            //使用default
            defalutValue(program.property[variableName].type!);
        }
    }
    new IR('ret', globalVariable.pointSize);
    //扫描definedType
    for (let typeName in program.definedType) {
        classScan(programScope.getClassScope(typeName));
    }
    for (let symbol of symbols) {
        console.log(symbol.name);
        console.table(symbol.irs);
    }
    console.table(addRelocationTable);
    for (let k in stackFrameMap) {
        console.log(k);
        console.table(stackFrameMap[k]);
    }
}
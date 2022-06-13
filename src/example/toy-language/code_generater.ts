import fs from "fs";
let program: Program;
let captureCounter = 0;
function closureScan(scope: Scope) {
    if (scope.captured.size > 0) {
        let closureTypeName = `@closure_${captureCounter}`;
        let properties: VariableDescriptor = {};
        for (let k of scope.captured) {
            //修改所有的load节点
            for (let n of scope.property[k].loadedNodes!) {
                delete n.load;//删除掉原来的Load
                n['accessField'] = { obj: { load: `var_${closureTypeName}` }, field: k };
            }
            delete scope.property[k].loadedNodes;//删除loadedNodes，在最终输出的代码里，这个属性已经不需要了
            properties[k] = scope.property[k];
        }
        //创建闭包类
        program.definedType[closureTypeName] = { operatorOverload: {}, property: JSON.parse(JSON.stringify(properties)), _constructor: {}, templates: scope.template };
        //在scope的block最前面插入一个new指令,new闭包类,还需要定义一个变量保存
        let def_variable: VariableDescriptor = {};
        def_variable[`var_${closureTypeName}`] = {
            variable: "var",
            initAST: {
                _new: {
                    type: { SimpleType: { name: closureTypeName } },
                    _arguments: []
                }
            }
        };
        scope.block.unshift({ def: def_variable });
        console.log(scope.captured);
        console.log(`捕获变量,需要修改对应节点`);//这里直接这样修改还不行，父节点链接不到修改之后的节点
        captureCounter++;//计数器加一
    }
}
//处理闭包捕获
function scopeProcessor(scope: Scope, node: ASTNode | Block) {
    if (Array.isArray(node)) {//是一个block
        let newScope: Scope = { isFunction: false, parent: scope, property: {}, captured: new Set(), block: node, template: scope.template.concat() };//为block创建Scope
        for (let n of node) {//遍历block的所有节点
            scopeProcessor(newScope, n);//递归扫描
        }
        closureScan(newScope);
    } else {
        //是一个普通节点
        if (node["def"] != undefined) {
            let key = Object.keys(node.def)[0];
            if (scope.property[key] != undefined) {
                throw new Error(`重复定义属性${key}`);
            } else {
                scope.property[key] = node.def[key];
                if (node.def[key].type?.FunctionType != undefined) {
                    let newScope: Scope = { isFunction: true, parent: scope, property: JSON.parse(JSON.stringify(node.def[key].type!.FunctionType!._arguments)), captured: new Set(), block: node.def[key].type!.FunctionType!.body, template: node.def[key].type!.FunctionType!.templates == undefined ? scope.template.concat() : scope.template.concat(node.def[key].type!.FunctionType!.templates!) };//为block创建Scope
                    for (let n of node.def[key].type!.FunctionType!.body) {
                        scopeProcessor(newScope, n);
                    }
                    /**
                     * 说明:
                     * function outer<T1>():void{
                     *      function inner<T2>():void{
                     *      }
                     * }
                     *  inner最终生成的代码：
                     *  function inner<T1,T2>():void xxx
                     *  对于closuerClass来说也是一样的，我好好设计一下
                     */
                    if (node.def[key].type?.FunctionType!.templates == undefined) {
                        node.def[key].type!.FunctionType!.templates = scope.template;
                    } else {
                        node.def[key].type!.FunctionType!.templates = scope.template.concat(node.def[key].type!.FunctionType!.templates!);
                    }
                    closureScan(newScope);
                }
            }
        }
        else if (node["load"] != undefined) {
            let key = node["load"];
            let tmpScope: Scope | undefined = scope;
            let functionScopeLevel = 0;
            while (tmpScope != undefined && tmpScope.property[key] == undefined) {//一直向上搜索，直到搜索完毕或者找到指定的property
                if (tmpScope.isFunction) {
                    functionScopeLevel++;
                }
                tmpScope = tmpScope.parent;
            }
            if (tmpScope == undefined || tmpScope.property[key] == undefined) {
                throw new Error(`使用了未定义的属性${key}`);
            } else {
                if (tmpScope.property[key].loadedNodes == undefined) {
                    tmpScope.property[key].loadedNodes = new Array();
                }
                tmpScope.property[key].loadedNodes!.push(node);
                if (functionScopeLevel > 0) {//等于1表示scope还在本function内部
                    tmpScope.captured.add(key);
                }
            }
        }
        else if (node["call"] != undefined) {
            scopeProcessor(scope, node.call.functionObj);
            for (let n of node['call']._arguments) {
                scopeProcessor(scope, n);
            }
        }
        else if (node["accessField"] != undefined) {
            scopeProcessor(scope, node.accessField.obj);
        }
        else if (node["_super"] != undefined) { }
        else if (node["_this"] != undefined) { }
        else if (node["immediate"] != undefined) {
            if (node.immediate.functionValue != undefined) {
                let newScope: Scope = { isFunction: true, parent: scope, property: JSON.parse(JSON.stringify(node.immediate.functionValue._arguments)), captured: new Set(), block: node.immediate.functionValue.body, template: node.immediate.functionValue.templates == undefined ? scope.template.concat() : scope.template.concat(node.immediate.functionValue.templates) };//为block创建Scope
                for (let n of node.immediate.functionValue.body) {
                    scopeProcessor(newScope, n);
                }
                closureScan(newScope);
            }
        }
        else if (node["trycatch"] != undefined) { }
        else if (node["throwStmt"] != undefined) {
            scopeProcessor(scope, node['throwStmt']);
        }
        else if (node["ret"] != undefined) {
            if (node.ret != '') {
                scopeProcessor(scope, node.ret);
            }
        }
        else if (node["ifStmt"] != undefined) {
            scopeProcessor(scope, node.ifStmt.condition);
            if (Array.isArray(node.ifStmt.stmt)) {
                let newScope: Scope = { isFunction: false, parent: scope, property: {}, captured: new Set(), block: node.ifStmt.stmt, template: scope.template.concat() };//为block创建Scope
                for (let n of node.ifStmt.stmt) {
                    scopeProcessor(newScope, n);
                }
                closureScan(newScope);
            } else {
                scopeProcessor(scope, node.ifStmt.stmt);
            }
        }
        else if (node["ifElseStmt"] != undefined) {
            scopeProcessor(scope, node.ifElseStmt.condition);
            if (Array.isArray(node.ifElseStmt.stmt1)) {
                let newScope: Scope = { isFunction: false, parent: scope, property: {}, captured: new Set(), block: node.ifElseStmt.stmt1, template: scope.template.concat() };//为block创建Scope
                for (let n of node.ifElseStmt.stmt1) {
                    scopeProcessor(newScope, n);
                }
                closureScan(newScope);
            } else {
                scopeProcessor(scope, node.ifElseStmt.stmt1);
            }
            if (Array.isArray(node.ifElseStmt.stmt2)) {
                let newScope: Scope = { isFunction: false, parent: scope, property: {}, captured: new Set(), block: node.ifElseStmt.stmt2, template: scope.template.concat() };//为block创建Scope
                for (let n of node.ifElseStmt.stmt2) {
                    scopeProcessor(newScope, n);
                }
                closureScan(newScope);
            } else {
                scopeProcessor(scope, node.ifElseStmt.stmt2);
            }
        }
        else if (node["do_while"] != undefined) {
            scopeProcessor(scope, node.do_while.condition);
            if (Array.isArray(node.do_while.stmt)) {
                let newScope: Scope = { isFunction: false, parent: scope, property: {}, captured: new Set(), block: node.do_while.stmt, template: scope.template.concat() };//为block创建Scope
                for (let n of node.do_while.stmt) {
                    scopeProcessor(newScope, n);
                }
                closureScan(newScope);
            } else {
                scopeProcessor(scope, node.do_while.stmt);
            }
        }
        else if (node["_while"] != undefined) {
            scopeProcessor(scope, node._while.condition);
            if (Array.isArray(node._while.stmt)) {
                let newScope: Scope = { isFunction: false, parent: scope, property: {}, captured: new Set(), block: node._while.stmt, template: scope.template.concat() };//为block创建Scope
                for (let n of node._while.stmt) {
                    scopeProcessor(newScope, n);
                }
                closureScan(newScope);
            } else {
                scopeProcessor(scope, node._while.stmt);
            }
        }
        else if (node["_for"] != undefined) {
            if (node._for.init != undefined) {
                scopeProcessor(scope, node._for.init);
            }
            if (node._for.condition != undefined) {
                scopeProcessor(scope, node._for.condition);
            }
            if (node._for.step != undefined) {
                scopeProcessor(scope, node._for.step);
            }
            if (Array.isArray(node._for.stmt)) {
                let newScope: Scope = { isFunction: false, parent: scope, property: {}, captured: new Set(), block: node._for.stmt, template: scope.template.concat() };//为block创建Scope
                for (let n of node._for.stmt) {
                    scopeProcessor(newScope, n);
                }
                closureScan(newScope);
            } else {
                scopeProcessor(scope, node._for.stmt);
            }
        }
        else if (node["_break"] != undefined) { }
        else if (node["_continue"] != undefined) { }
        else if (node["_instanceof"] != undefined) {
            scopeProcessor(scope, node._instanceof.obj);
        }
        else if (node["not"] != undefined) {
            scopeProcessor(scope, node.not.child);
        }
        else if (node["increase"] != undefined) {
            scopeProcessor(scope, node.increase.child);
        }
        else if (node["decrease"] != undefined) {
            scopeProcessor(scope, node.decrease.child);
        }
        else if (node["indexOP"] != undefined) {
            scopeProcessor(scope, node.indexOP.obj);
            scopeProcessor(scope, node.indexOP.index);
        }
        else if (node["ternary"] != undefined) {
            scopeProcessor(scope, node.ternary.condition);
            scopeProcessor(scope, node.ternary.obj1);
            scopeProcessor(scope, node.ternary.obj2);
        }
        else if (node["immediate"] != undefined) { }
        else if (node["cast"] != undefined) {
            scopeProcessor(scope, node.cast.obj);
        }
        else if (node["_new"] != undefined) {
            for (let n of node['_new']._arguments) {
                scopeProcessor(scope, n);
            }
        }
        else if (node["_newArray"] != undefined) {
            for (let n of node['_newArray'].initList) {
                scopeProcessor(scope, n);
            }
        }
        else if (node["="] != undefined) {
            scopeProcessor(scope, node['='].leftChild);
            scopeProcessor(scope, node['='].rightChild);
        }
        else if (node["+"] != undefined) {
            scopeProcessor(scope, node['+'].leftChild);
            scopeProcessor(scope, node['+'].rightChild);
        }
        else if (node["-"] != undefined) {
            scopeProcessor(scope, node['-'].leftChild);
            scopeProcessor(scope, node['-'].rightChild);
        }
        else if (node["*"] != undefined) {
            scopeProcessor(scope, node['*'].leftChild);
            scopeProcessor(scope, node['*'].rightChild);
        }
        else if (node["/"] != undefined) {
            scopeProcessor(scope, node['/'].leftChild);
            scopeProcessor(scope, node['/'].rightChild);
        }
        else if (node["<"] != undefined) {
            scopeProcessor(scope, node['<'].leftChild);
            scopeProcessor(scope, node['<'].rightChild);
        }
        else if (node["<="] != undefined) {
            scopeProcessor(scope, node['<='].leftChild);
            scopeProcessor(scope, node['<='].rightChild);
        }
        else if (node[">"] != undefined) {
            scopeProcessor(scope, node['>'].leftChild);
            scopeProcessor(scope, node['>'].rightChild);
        }
        else if (node[">="] != undefined) {
            scopeProcessor(scope, node['>='].leftChild);
            scopeProcessor(scope, node['>='].rightChild);
        }
        else if (node["=="] != undefined) {
            scopeProcessor(scope, node['=='].leftChild);
            scopeProcessor(scope, node['=='].rightChild);
        }
        else if (node["||"] != undefined) {
            scopeProcessor(scope, node['||'].leftChild);
            scopeProcessor(scope, node['||'].rightChild);
        }
        else if (node["&&"] != undefined) {
            scopeProcessor(scope, node['&&'].leftChild);
            scopeProcessor(scope, node['&&'].rightChild);
        }
        else if (node["_switch"] != undefined) {
            scopeProcessor(scope, node._switch.pattern);
            if (node._switch.defalutStmt != undefined) {
                if (Array.isArray(node._switch.defalutStmt)) {
                    let newScope: Scope = { isFunction: false, parent: scope, property: {}, captured: new Set(), block: node._switch.defalutStmt, template: scope.template.concat() };//为block创建Scope
                    for (let n of node._switch.defalutStmt) {
                        scopeProcessor(newScope, n);
                    }
                    closureScan(newScope);
                } else {
                    scopeProcessor(scope, node._switch.defalutStmt);
                }
            }
            for (let matcItem of node._switch.matchList) {
                scopeProcessor(scope, matcItem.matchObj);
                if (Array.isArray(matcItem.stmt)) {
                    let newScope: Scope = { isFunction: false, parent: scope, property: {}, captured: new Set(), block: matcItem.stmt, template: scope.template.concat() };//为block创建Scope
                    for (let n of matcItem.stmt) {
                        scopeProcessor(newScope, n);
                    }
                    closureScan(newScope);
                } else {
                    scopeProcessor(scope, matcItem.stmt);
                }
            }
        } else {
            throw new Error(`存在未定义的ASTNode`);
        }
    }
}
//闭包扫描
export default function clouserScan(program_source: string) {
    program = JSON.parse(program_source) as Program;
    let property = program.property;
    let programScope: Scope = { parent: undefined, property: JSON.parse(JSON.stringify(property)), isFunction: false, captured: new Set(), block: [], template: [] };//program的scope暂时没有代码，class的也一样
    for (let key in property) {
        let prop = property[key];
        if (prop?.type?.FunctionType != undefined) {//处理顶层Fcuntion
            let functionScope: Scope = { isFunction: true, parent: programScope, property: JSON.parse(JSON.stringify(prop.type.FunctionType._arguments)), captured: new Set(), block: prop.type.FunctionType.body, template: prop?.type?.FunctionType.templates == undefined ? [] : prop?.type?.FunctionType.templates.concat() };
            for (let node of prop.type.FunctionType.body) {
                scopeProcessor(functionScope, node);
            }
            closureScan(functionScope);
        }
    }
    fs.writeFileSync('./src/example/toy-language/output/stage-2.json', JSON.stringify(program));
}
// clouserScan(fs.readFileSync("./src/example/toy-language/output/stage-1.json").toString());








/**
 * 一:代码生成
 *  1.类型推导(推导所有的自动类型变量，对循环推导报错提示)
 *  2.语法检查
 *      2.1 类型检查(==,if、while、for的条件是bool)
 *      2.2 操作符重载检查,("+","-","*","/","!","||","&&"等操作符的类型检查)
 *      2.3 成员访问检查,(a.b要检查a是否有属性b)
 * 二:闭包处理
 *  1.scope的模板向下累加传递(模板类型声明顺序似乎无关，所以上层的放到本层前面,使用unshift添加)
 *  2.闭包类定义时，将本层scope的template加进去作为模板类
 *  3.new闭包类时加上instance模板
 *  4.内部function和闭包类同理，声明为模板函数
 *  5.实例化
 * 
 * 感觉还是有问题，再想想
 * 闭包处理要在代码生成前完成
 */
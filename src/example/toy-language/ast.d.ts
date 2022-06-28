/*
https://262.ecma-international.org/11.0/#sec-ordinary-object-internal-methods-and-internal-slots-ownpropertykeys
根据ES2015的标准，key也是有序的，不用数字做key即可
可以作为数组索引的 key 按照升序排列，例如 1、2、3。
是字符串不是 symbol 的 key，按照创建顺序排列。
symbol 类的 key 按照创建顺序排列。
Reflect.ownKeys({
  [Symbol('07akioni')]: '',
  18: '',
  star: '',
  4: '',
  kirby: '',
})
// ['4', '18', 'star', 'kirby', Symbol(07akioni)]
*/
//定义的类型
interface TypeDef {
    modifier?: 'valuetype' | 'sealed';
    templates?: string[];//模板列表
    extends?: TypeUsed;//基类
    operatorOverload: {//重载列表
        [key: string]: FunctionType//key为操作符
    };
    property: VariableDescriptor;//属性列表
    _constructor: { [key: string]: FunctionType };//key为函数签名
}
//变量描述符，包含变量的名字、类型以及初始化使用的语法树
type VariableDescriptor = { [key: string]: VariableProperties };
//变量属性
interface VariableProperties {
    variable: 'var' | 'val' | 'g-set';
    type?: TypeUsed;//需要类型推导的变量可以先不设置Type
    initAST?: ASTNode;//当type为undefined的时候,initAST必须存在,否则无法确定类型
    getter?: FunctionType;//getter
    setter?: FunctionType;//setter
    loadedNodes?: ASTNode[];//记录load本属性的node，在确定本属性为闭包捕获属性后，把这些load节点全部换成load闭包里面的属性
}
interface TypeUsed {
    SimpleType?: SimpleType;
    FunctionType?: FunctionType;
    ArrayType?: ArrayType;
}
interface SimpleType {
    name: string;//使用的类型
    templateSpecialization?: TypeUsed[];//实例化模板的类型
}
interface ArrayType {
    innerType: TypeUsed;
}
interface FunctionType {
    _arguments: VariableDescriptor;
    body: Block;//函数体
    retType?: TypeUsed;//返回类型，可选，如果为undefined则需要进行类型推导
    templates?: string[];//模板列表
    _construct_for_type?: string;//是某个类型的构造函数
}
type Block = Array<(ASTNode | Block)>;
interface Program {
    definedType: {//已经定义了的类型
        [key: string]: TypeDef
    };
    property: VariableDescriptor;
}
//一条语句就是一个Noe
interface ASTNode {
    isLoaction?:boolean;//是否为可修改节点
    accessField?: { obj: ASTNode, field: string };
    call?: { functionObj: ASTNode, _arguments: ASTNode[], templateSpecialization_list?: TypeUsed[] };
    def?: VariableDescriptor;
    load?: string;
    _super?: "";
    _this?: "";
    immediate?: { functionValue?: FunctionType; primiviteValue?: | string | number; };//immediate只可以是数字、字符串、函数,对应了 1、"string"、()=>{console.log("aaa")}这几种情况
    trycatch?: { tryBlock: Block, catchVariable: string, catchType: TypeUsed, catchBlock: Block };
    throwStmt?: ASTNode;
    ret?: ASTNode | "";
    ifStmt?: { condition: ASTNode, stmt: ASTNode | Block };
    ifElseStmt?: { condition: ASTNode, stmt1: ASTNode | Block, stmt2: ASTNode | Block };
    do_while?: { condition: ASTNode, stmt: ASTNode | Block, label?: string };
    _while?: { condition: ASTNode, stmt: ASTNode | Block, label?: string };
    _for?: { init?: ASTNode, condition?: ASTNode, step?: ASTNode, stmt: ASTNode | Block, label: string | undefined };
    _break?: { label: string };
    _continue?: { label: string };
    _instanceof?: { obj: ASTNode, type: TypeUsed };
    not?: { child: ASTNode };
    increase?: { child: ASTNode };
    decrease?: { child: ASTNode };
    indexOP?: { obj: ASTNode, index: ASTNode };
    ternary?: { condition: ASTNode, obj1: ASTNode, obj2: ASTNode };
    cast?: { obj: ASTNode, type: TypeUsed };
    _new?: { type: TypeUsed, _arguments: ASTNode[] };
    _newArray?: { type: TypeUsed, initList: ASTNode[], placeholder: number };
    "="?: { rightChild: ASTNode; leftChild: ASTNode; };
    "+"?: { rightChild: ASTNode; leftChild: ASTNode; };
    "-"?: { rightChild: ASTNode; leftChild: ASTNode; };
    "*"?: { rightChild: ASTNode; leftChild: ASTNode; };
    "/"?: { rightChild: ASTNode; leftChild: ASTNode; };
    "<"?: { rightChild: ASTNode; leftChild: ASTNode; };
    "<="?: { rightChild: ASTNode; leftChild: ASTNode; };
    ">"?: { rightChild: ASTNode; leftChild: ASTNode; };
    ">="?: { rightChild: ASTNode; leftChild: ASTNode; };
    "=="?: { rightChild: ASTNode; leftChild: ASTNode; };
    "||"?: { rightChild: ASTNode; leftChild: ASTNode; };
    "&&"?: { rightChild: ASTNode; leftChild: ASTNode; };
    _switch?: { pattern: ASTNode, defalutStmt?: ASTNode | Block, matchList: { matchObj: ASTNode, stmt: ASTNode | Block }[] };//default没有matchObj
}
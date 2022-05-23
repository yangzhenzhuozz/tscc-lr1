import fs from "fs";
import TSCC from "../../tscc/tscc.js";
import { Grammar } from "../../tscc/tscc.js";
let grammar: Grammar = {
    tokens: ['var', 'val', '...', ';', 'id', 'immediate_val', '+', '-', '++', '--', '(', ')', '?', '{', '}', '[', ']', ',', ':', 'function', 'class', '=>', 'operator', 'new', '.', 'extends', 'if', 'else', 'do', 'while', 'for', 'switch', 'case', 'default', 'valuetype', 'import', 'as', 'break', 'continue', 'this', 'return', 'get', 'set', 'sealed', 'try', 'catch', 'throw', 'super', 'basic_type','instanceof'],
    association: [
        { 'right': ['='] },
        { 'right': ['?'] },
        { 'nonassoc': ['instanceof'] },
        { 'left': ['==', '!='] },
        { 'left': ['||'] },
        { 'left': ['&&'] },
        { 'left': ['!'] },
        { 'left': ['>', '<', '<=', '>='] },
        { 'left': ['+', '-'] },
        { 'left': ['*', '/'] },
        { 'left': ['++', '--'] },
        { 'right': ['=>'] },
        { 'nonassoc': ['low_priority_for_array_placeholder'] },//见array_placeholder注释
        { 'nonassoc': ['low_priority_for_['] },//见type注释
        { 'nonassoc': ['cast_priority'] },//强制转型比"("、"["、"."优先级低,比+ - * /优先级高,如(int)f()表示先执行函数调用再转型 (int) a+b表示先把a转型成int，然后+b
        { 'nonassoc': ['['] },
        { 'nonassoc': ['('] },
        { 'nonassoc': ['.'] },
        { 'nonassoc': ['low_priority_for_if_stmt'] },//这个符号的优先级小于else
        { 'nonassoc': ['else'] },
    ],
    BNF: [
        { "program:import_stmts program_units": {} },//整个程序由导入语句组和程序单元组构成
        { "import_stmts:": {} },//导入语句组可以为空
        { "import_stmts:import_stmts import_stmt": {} },//导入语句组由一条或者多条导入语句组成
        { "import_stmt:import id ;": {} },//导入语句语法
        { "program_units:": {} },//程序单元组可以为空
        { "program_units:program_units program_unit": {} },//程序单元组由一个或者多个程序单元组成
        { "program_unit:declare ;": {} },//程序单元可以是一条声明语句
        { "program_unit:class_definition": {} },//程序单元可以是一个类定义语句
        /**
         * var和val的区别就是一个可修改，一个不可修改,val类似于其他语言的const
         */
        { "declare:var id : type": {} },//声明语句_1，声明一个变量id，其类型为type
        { "declare:var id : type = object": {} },//声明语句_2，声明一个变量id，并且将object设置为id的初始值，object的类型要和声明的类型一致
        { "declare:var id = object": {} },//声明语句_3，声明一个变量id，并且将object设置为id的初始值，类型自动推导
        { "declare:val id : type": {} },//声明语句_4，声明一个变量id，其类型为type
        { "declare:val id : type = object": {} },//声明语句_5，声明一个变量id，并且将object设置为id的初始值，object的类型要和声明的类型一致
        { "declare:val id = object": {} },//声明语句_6，声明一个变量id，并且将object设置为id的初始值，类型自动推导
        { "declare:function_definition": {} },//声明语句_7，可以是一个函数定义语句
        { "class_definition:modifier class basic_type template_declare extends_declare { class_units }": {} },//class定义语句由修饰符等组成(太长了我就不一一列举)
        { "extends_declare:": {} },//继承可以为空
        { "extends_declare:extends type": {} },//继承,虽然文法是允许继承任意类型,但是在语义分析的时候再具体决定该class能不能被继承
        { "function_definition:function id template_declare ( parameter_declare ) ret_type { statements }": {} },//函数定义语句，同样太长，不列表
        { "ret_type:": {} },//返回值类型可以不声明，自动推导,lambda就不用写返回值声明
        { "ret_type: : type": {} },//可以声明返回值类型,function fun() : int {codes}
        { "modifier:valuetype": {} },//modifier可以是"valuetype"
        { "modifier:sealed": {} },//modifier可以是"sealed"
        { "modifier:": {} },//modifier可以为空
        { "template_declare:": {} },//模板声明可以为空
        { "template_declare:template_definition": {} },//模板声明可以是一个模板定义
        { "template_definition:< template_definition_list >": {} },//模板定义由一对尖括号<>和内部的template_definition_list组成
        { "template_definition_list:id": {} },//template_definition_list可以是一个id
        { "template_definition_list:template_definition_list , id": {} },//template_definition_list可以是一个template_definition_list后面接上 , id
        { "type:( type )": {} },//type可以用圆括号包裹
        /**
         * type后面的'['会导致如下二义性:
         * 所有type都有这种情况，用int作为一个type举例
         * 情况1. new int []
         * 1.1 new (int)[]  
         * 1.2 new (int[])
         * 情况2. function fun():int []
         * 2.1 (function fun():int)[] 是一个函数数组
         * 2.2 function fun():(int[]) 是一个返回数组的函数
         * 上述两种情况我们都希望取第二种语法树，所以type相关的几个产生式优先级都设置为低于'[',凡是遇到符号'['一律移入
         * question: 
         * 输入:"new int[][][3][];"和"new int[][][][]" 是否合法?
         * answer:
         * 不合法,对于输入"new int[][][3][];"来说,也许你会认为这个串会被解析成
         * new (int[][])[3][];
         * 其中int[][]会被解析成type,则这个输入对应了产生式 object:new type [3][]
         * 我们分析一下编译器的格局:
         * new int[][].[3][],此时遇到了符号'[',因为我们规定这个格局应该选择移入而不是规约,所以编译器还在type产生式还没有规约完成
         * new int[][][][],并且把(int[][][][])规约成type,则这个串会被规约成new type，然而new type的时候是必须调用构造函数的,所以输入new int[][][][]也是非法的
         * 合法的输入应该是new int[][][][](),当然这只是符合文法而已,在语义检查的时候我们会进行错误处理,有的type是不允许被new的(说的就是array_type)
         */
        { "type:basic_type": { priority: "low_priority_for_[" } },//type可以是一个base_type
        { "type:basic_type templateSpecialization": { priority: "low_priority_for_[" } },//type可以是一个base_type templateSpecialization
        { "type:template_definition ( parameter_declare ) => type": { priority: "low_priority_for_[" } },//泛型函数类型
        { "type:( parameter_declare ) => type": { priority: "low_priority_for_[" } },//函数类型
        { "type:type array_type_list": { priority: "low_priority_for_[" } },//数组类型
        { "array_type_list:[ ]": {} },//array_type_list可以是一对方括号
        { "array_type_list:array_type_list [ ]": {} },//array_type_list可以是array_type_list后面再接一对方括号
        { "parameter_declare:parameter_list": {} },//parameter_declare可以由parameter_list组成
        { "parameter_declare:": {} },//parameter_declare可以为空
        { "parameter_list:id : type": {} },//parameter_list可以是一个 id : type
        { "parameter_list:parameter_list , id : type": {} },//parameter_list可以是一个parameter_list接上 , id : type
        { "class_units:class_units class_unit": {} },//class_units可以由多个class_unit组成
        { "class_units:": {} },//class_units可以为空
        { "class_unit:declare ;": {} },//class_unit可以是一个声明语句
        { "class_unit:operator_overload": {} },//class_unit可以是一个运算符重载
        { "class_unit:get id ( ) : type { statements }": {} },//get
        { "class_unit:set id ( id : type ) { statements }": {} },//set
        { "class_unit:basic_type ( parameter_declare )  { statements }": {} },//构造函数
        { "class_unit:default ( )  { statements }": {} },//default函数,用于初始化值类型
        { "operator_overload:operator + ( id : type ) : type { statements }": {} },//运算符重载,运算符重载实在是懒得做泛型了,以后要是有需求再讲,比起C#和java的残废泛型，已经很好了
        { "statements:statements statement": {} },//statements可以由多个statement组成
        { "statements:": {} },//statements可以为空
        { "statement:declare ;": {} },//statement可以是一条声明语句
        { "statement:try { statements } catch ( id : type ) { statements }": {} },//try catch语句，允许捕获任意类型的异常
        { "statement:throw object ;": {} },//抛异常语句
        { "statement:return object ;": {} },//带返回值的返回语句
        { "statement:return ;": {} },//不带返回值的语句
        { "statement:if ( object ) statement": { priority: "low_priority_for_if_stmt" } },//if语句
        /**
         * 本规则会导致如下二义性:
         * if(obj)      ---1
         *   if(obj)    ---2
         *      stmt
         *   else
         *      stmt
         * 可以得到如下两种abstract syntax tree
         * if(obj)
         * {
         *      if(obj)
         *      {
         *          stmt
         *      }
         * }
         * else
         * {
         *      stmt
         * }
         * 
         * if(obj)
         * {
         *      if(obj)
         *      {
         *          stmt
         *      }
         *      else
         *      {
         *          stmt
         *      }
         * }
         * 为了和大部分的现有编程语言兼容，采用第二种抽象语法树进行规约
         * 定义两个优先级规则low_priority_for_if_stmt和else,使else的优先级高于low_priority_for_if_stmt,在产生冲突时选择移入
         */
        { "statement:if ( object ) statement else statement": {} },//if else语句
        { "statement:label_def do statement while ( object ) ;": {} },//do-while语句，其实我是想删除while语句的，我觉得for_loop可以完全替代while,一句话,为了看起来没这么怪
        { "statement:label_def while ( object ) statement": {} },//while语句
        { "statement:label_def for ( for_init ; for_condition ; for_step ) statement": {} },//for_loop
        { "statement:block": { action: ($, s) => $[0] } },//代码块
        { "statement:break label_use ;": {} },//break语句
        { "statement:continue label_use ;": {} },//continue语句
        { "statement:switch ( object ) { switch_bodys }": {} },//switch语句,因为switch在C/C++等语言中可以用跳转表处理,gcc在处理switch语句时,如果各个case的值连续,也会生成一个jum_table,这里我就稍微扩展一下switch的用法
        { "statement:object ;": {} },//类似C/C++中的   1; 这种语句,java好像不支持这种写法
        { "label_def:": {} },//label_def可以为空
        { "label_def:id :": {} },//label_def为 id : 组成
        { "for_init:": {} },//for_loop的init可以为空
        { "for_init:declare": {} },//init可以是一个声明
        { "for_init:object": {} },//也可以是一个对象
        { "for_condition:": {} },//condition可以为空
        { "for_condition:object": {} },//condition可以是一个对象(必须是bool对象)
        { "for_step:": {} },//step可以为空
        { "for_step:object": {} },//step可以是一个对象
        { "block:{ statements }": {} },//代码块是一对花括号中间包裹着statements
        { "label_use:": {} },//在break和continue中被使用
        { "label_use:id": {} },//在break和continue中被使用
        { "switch_bodys:": {} },//switch_bodys可为空
        { "switch_bodys:switch_bodys switch_body": {} },//switch_bodys可以由多个switch_body组成
        { "switch_body:case object : statement": {} },//case 语句
        { "switch_body:default : statement": {} },//default语句
        { "object:( object )": {} },//括号括住的object还是一个object
        { "object:object . id": {} },//取成员
        /**
        * obj_1 + obj_2  ( obj_3 )  ,中间的+可以换成 - * / < > || 等等双目运算符
        * 会出现如下二义性:
        * 1、 (obj_1 + obj_2)  ( object_3 ) ,先将obj_1和obj_2进行双目运算，然后再使用双目运算符的结果作为函数对象进行函数调用
        * 2、 obj_1 + ( obj_2  ( object_3 ) ) ,先将obj_2作为一个函数对象调用，然后再将obj_1 和函数调用的结果进行双目运算
        * 因为我们希望采取二义性的第二种解释进行语法分析,所以设置了'('优先级高于双目运算符,这些双目运算符是所在产生式的最后一个终结符，直接修改了对应产生式的优先级和结核性
        * 同样的,对于输入"(int)obj_1(obj_2)"有如下二义性:
        * 1. ((int)obj_1) (obj_2)
        * 2. (int) (obj_1(obj_2))
        * 也采用方案2，令函数调用优先级高于强制转型
        */
        { "object:object  ( arguments )": {} },//函数调用
        { "object:object < templateSpecialization_list > ( arguments )": {} },//模板函数调用
        /**
         * 一系列的双目运算符,二义性如下:
         * a+b*c
         * 1. (a+b)*c
         * 2. a+(b*c)
         * 已经把各个操作符的优先级和结合性定义的和C/C++一致，见association中定义的各个符号优先级和结合性,双目运算符都是左结合,且+ - 优先级低于 * /
         */
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
        /**
         * instanceof会导致如下冲突:
         * 情况1: ! a instanceof int
         * 1.1 !(a instanceof int)
         * 1.2 (!a) instanceof int
         * 情况2: a+b instanceof int
         * 2.1 a+(b instanceof int)
         * 2.2 (a+b) instanceof int
         * 我希望instanceof的优先级低于所有的其他运算符,对于上述情况都选择第二种AST进行规约,所以定义了instanceof的优先级低于所有的其他运算符(除了赋值符号)
         */
        { "object:object instanceof type": {} },
        /**双目运算符结束 */
        /**单目运算符 */
        { "object:! object": {} },//单目运算符-非
        { "object:object ++": {} },//单目运算符++
        { "object:object --": {} },//单目运算符--
        /**单目运算符结束 */
        { "object:object [ object ]": {} },//[]运算符
        /**
         * 三目运算符会导致如下文法二义性
         * 情况1:a+b?c:d
         * 1.1 a+(b?c:d)
         * 1.2 (a+b)?c:d
         * 情况2:a?b:c?d:e
         * 2.1 (a?b:c)?d:e
         * 2.2 a?b:(c?d:e)
         * 根据tscc的解析规则，产生object:object ? object : object 的优先级为未定义，因为优先级取决于产生式的最后一个终结符或者强制指定的符号,该产生式的最后一个终结符':'并没有定义优先级
         * 为了解决上述两种冲突,我们将产生式的优先级符号强制指定为?,并且令?的优先级低于双目运算符,结合性为right,则针对上述两种冲突最终解决方案如下:
         * 1.因为?的优先级低于所有双目运算符所对应的产生式,所以情况1会选择1.2这种语法树进行解析
         * 2.因为?为右结合,所以情况2会选择2.2这种语法树进行解析
         */
        { "object:object ? object : object": { priority: "?" } },//三目运算
        { "object:id": {} },//id是一个对象
        { "object:immediate_val": {} },//立即数是一个object
        { "object:super": {} },//super是一个对象
        { "object:this": {} },//this是一个object
        { "object:template_definition ( parameter_declare ) => { statements }": {} },//模板lambda
        { "object:( parameter_declare ) => { statements }": {} },//lambda
        /**
         * 强制转型会出现如下二义性:
         * 情况1 (int)a+b;
         * 1.1 ((int)a)+b;
         * 1.2 (int)(a+b)
         * 情况2 (int)fun(b);
         * 2.1 ((int)fun)(b)
         * 2.2 (int)(fun(b))
         * 情况3 (int)arr[0]
         * 3.1 ((int)arr) [0]
         * 3.2 (int)(arr[0])
         * 参照java优先级,强制转型优先级高于+ - / * ++ 这些运算符，低于() [] .这三个运算符
         * 为其指定优先级为cast_priority
         */
        { "object:( type ) object": { priority: "cast_priority" } },//强制转型
        { "object:new type  ( arguments )": {} },//创建对象
        /**
         * 假设只针对产生式array_init_list:array_inits array_placeholder 会出现如下二义性
         * new int [10][3]可以有如下两种解释:(把array_placeholder规约成ε)
         * 1. (new int[10])[3],先new 一个一维数组,然后取下标为3的元素
         * 2. (new int[10][3]),new 一个二维数组
         * 我当然希望采取第二种语法树,所以需要设置产生式优先级,即在new一个对象的时候,如果后面跟有方括号[,优先选择移入而不是规约,那么只需要把冲突的产生式优先级设置为比'['低即可
         * 设置array_placeholder作为产生式头的两个产生式优先级低于'['
         */
        { "object:new type array_init_list": {} },//创建数组
        { "array_init_list:array_inits array_placeholder": {} },//new 数组的时候是可以这样写的 new int [2][3][][],其中[2][3]对应了array_inits,后面的[][]对应了array_placeholder(数组占位符)
        { "array_inits:array_inits [ object ]": {} },//见array_init_list一条的解释
        { "array_inits:[ object ]": {} },//见array_init_list一条的解释
        { "array_placeholder:array_placeholder_list": { priority: "low_priority_for_array_placeholder" } },//见array_init_list一条的解释
        { "array_placeholder:": { priority: "low_priority_for_array_placeholder" } },//array_placeholder可以为空
        { "array_placeholder_list:array_placeholder_list [ ]": {} },//见array_init_list一条的解释
        { "array_placeholder_list:[ ]": {} },//见array_init_list一条的解释
        { "templateSpecialization:< templateSpecialization_list >": {} },//模板实例化可以实例化为一个<templateSpecialization_list>
        { "templateSpecialization_list:type": {} },//templateSpecialization_list可以为一个type
        { "templateSpecialization_list:templateSpecialization_list , type": {} },//templateSpecialization_list可以为多个type
        { "arguments:": {} },//实参可以为空
        { "arguments:argument_list": {} },//实参可以是argument_list
        { "argument_list:object": {} },//参数列表可以是一个object
        { "argument_list:argument_list , object": {} },//参数列表可以是多个object
    ]
}
let tscc = new TSCC(grammar, { language: "zh-cn", debug: false });
let str = tscc.generate();//构造编译器代码
if (str != null) {//如果构造成功则生成编编译器代码
    console.log(`成功`);
} else {
    console.log(`失败`);
}
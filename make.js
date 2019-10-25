
const fs = require('fs');
const colors = require('colors');
const deasync = require('deasync');

var debug = false;
var cwd = process.cwd();

const utils = require('./utils.js');

// Classes
const CallbacksManager = require('./callbacksManager.js');

// Objects
var compilersSettings = require('./compilersSettings.js');
var executionsManager = require('./executionsManager.js');


// Generic settings
var buildFolderDir = 'build/';

///
/// Make class
///
module.exports = {
    init: function(){
        this.language = '';
        this.flags = '';
        this.includes = [];
        this.objectsToCompile = [];
        this.out = '';
        this.buildFolder = false;
    },
    
    setLanguage: function(language){
        this.language = language.toLowerCase();
        this.compiler = compilersSettings.functions.getCompilerByLanguage(this.language);
    },
        
    addFlags: function(arg){
        if(this.flags.length > 0) this.flags += ' ';
        this.flags = utils.arrayToString(arg);
    },
    
    include: function(arg){
        var incl = utils.stringToArray(arg);
        utils.addArrayToArray(this.includes, incl);
    },
    
    compileObjects: function(objs){
        objs = utils.stringToArray(objs);
        utils.addArrayToArray(this.objectsToCompile, objs);
    },
    
    useBuildFolder: function(status){
        this.buildFolder = status;
    },
    
    // todo: repleceable with utils.createPathIfNecessary()
    checkBuildFolder: function(){
        this.buildDir = cwd + '/' + buildFolderDir;
        if(!fs.existsSync(this.buildDir))
            fs.mkdirSync(this.buildDir);
    },
    
    _buildCompilerCommand: function(settings, cbk){
        if(typeof settings !== 'object')
            settings = {file: settings};
        
        var cmd = '';
        cmd += this.compiler.getCmd();
        cmd += ' ' + this.compiler.getDefaultFlags();
        cmd += ' ' + this.flags;
        
        // Manage includes
        for(var i in this.includes){
            cmd += ' ' + this.compiler.include(this.includes[i]);
        }
        
        // Link objects
        if(settings.linkObjects){
            for(var o of settings.linkObjects){
                cmd + ' ' + o;
            }
        }
        
        // Set the subject file
        cmd += ' ' + settings.file;
        
        // Set the out file
        cmd += ' -o ';
        
        var outFile = '';
        if(settings.isMainFile) 
            outFile = this.out || utils.filenameWithoutExtension(this.entryFile) + '.o'
        else 
            outFile = (this.buildFolder ? buildFolderDir : '') + utils.filenameWithoutExtension(settings.file) + '.o'; 

        cmd += outFile;
        
        utils.createPathIfNecessary(outFile);
        
        var _res = false;
        executionsManager.exec(cmd, (res)=>{      
            if(res.err){
                // Kill all processes
                executionsManager.killAllProcesses();
                
                console.log('\r\n', '!!! ERROR !!!'.bgRed.white.bold);
                console.log('File: \t'.red.bold, file.red.underline);
                console.log('');
                console.log(res.err.message.brightRed.bold.bgBlack);
                console.log('Operation aborted.'.brightRed.bold.bgBlack, '\r\n');
                
                process.exit(0);
            }
            
            if(cbk)
                cbk(res, outFile);
            else
                _res = res;
        });
        
        if(!cbk){
            deasync.loopWhile(function(){return !_res;});
            
            _res.outFile = outFile;
        }
            
        return _res;
    },
    
    // Compile all files
    compile: function(){ 
        if(!this.entryFile){
            console.log('Error: entry file is not setted'.red.bold);
            process.exit(0);
        }
        
        if(!this.compiler){
            if(this.language)
                throw new Error('Unable to compile: language ' + this.language.toUpperCase() + ' not found');
            else
                throw new Error('Unable to compile: programming language not setted');
        }
        
        if(this.buildFolder)
            this.checkBuildFolder();
        
        // Check objects file to compile
        var files = findFilesParser(this.objectsToCompile);
        
        // Remove entry point file if necessary
        var entryIndex = files.indexOf(this.entryFile);
        if(entryIndex >= 0) files.splice(entryIndex, 1);
        
        //
        // Start async compilation of object files
        //
        var cbksManager = new CallbacksManager();
        var outObjects = [];
        
        cbksManager.callbackCompleteEvent((file, res, outFile)=>{            
            console.log('Successfully compiled: \t',file, ' '.repeat(30-file.length), 'at ', outFile);
            outObjects.push(outFile);
        });
        
        console.log('Beginning object compilation...'.bold);
        
        // Compile all objects!
        var numFiles = files.length;
        for(var f=0; f<numFiles; f++){
            var file = files[f];
            this._buildCompilerCommand(file, cbksManager.getCallback(file));
        }
        
        cbksManager.wait();
        console.log('Objects compiled!'.bold, '\r\n');
        
        ///
        /// Compile main file!
        ///
        console.log(('Compiling ' + this.entryFile + '...').bold);
        var settings = {isMainFile: true, file: this.entryFile, linkObjects: outObjects };
        
        var res = this._buildCompilerCommand(settings);
        console.log((this.out + ' sucessfully compiled!').bold);
        console.log('\r\nOperation completed!'.bold, '\r\n');
    }
};

///
/// FS Utils
///
function findFilesParser(folders){
    var files = [];
    folders = utils.stringToArray(folders);
    
    for(var f in folders){
        var folder = folders[f];
        var path = '', types = '', recursive = false;
        
        var asterisk = false;
        for (var c = 0; c < folder.length; c++) {
            var ch = folder.charAt(c);
            
            if(ch == '*')
                asterisk = true;
            else {
                if(!asterisk)
                    path += ch;
                else {
                    if(ch == '/'){
                        recursive = true;
                        types = '';
                    }
                    else 
                        types += ch;
                }
            }
        }
        
        types = types.substr(1).split('.')
        
        if(!asterisk)
            files.push(path);
        else {
            if(!types[0]) types = false;
            utils.addArrayToArray(files, listFiles(cwd+'/'+path, types, recursive));
        }
        
        if(debug){
            console.log({
                path: path,
                types: types,
                recursive: recursive,
                asterisk: asterisk
            });
        }   
    }
    
    return files;
}

function listFiles(path, types, recursive){
    var retFiles = [];
    var files = fs.readdirSync(path);
    
    for(var f in files){
        var file = files[f];
        var stat = fs.lstatSync(path+'/'+file);
        
        if(stat.isDirectory()){
            if(recursive){
                var _files = listFiles(path+'/'+file, types, recursive);
                
                if(_files.length > 0)
                    utils.addArrayToArray(retFiles, _files);
            }
        }
        else {
            // Set file path
            file = path.substr(cwd.length + 1) + file;
            
            if(types){
                for(var type of types){
                    if(file.endsWith('.'+type)){
                        retFiles.push(file);
                        break;
                    }
                }
            }
            else 
                retFiles.push(file);
        }
    }
    
    return retFiles;
}



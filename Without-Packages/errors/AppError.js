class AppError extends Error {

    constructor(message,statusCode,code,fields = null){
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.fields = fields;
    }
}

module.exports = AppError;
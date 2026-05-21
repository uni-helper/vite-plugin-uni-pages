<script lang="ts" setup>
import { isMpAlipay, isH5 } from '@uni-helper/uni-env'

definePage(() => {
    let title = 'hello world';

    // 条件编译
    if (isMpAlipay) {
        title += ': MP Alipay';
    }
    if (isH5) {
        title += ': H5';
    }

    return {
        style: {
            navigationBarTitleText: title,
        },
        middlewares: [
            'auth',
        ],
    };
});
</script>

<template>
    <div>define page in function mode</div>
</template>

# Generated by Django 2.1.4 on 2019-01-15 21:11

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('style', '0001_squashed_0002_auto_20151226_1110'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('document', '0003_auto_20181115_0926'),
    ]

    operations = [
        migrations.CreateModel(
            name='DocumentTemplate',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(blank=True, default='', max_length=255)),
                ('definition', models.TextField(default='{}')),
                ('definition_hash', models.CharField(blank=True, default='', max_length=22)),
                ('citation_styles', models.ManyToManyField(to='style.CitationStyle')),
                ('document_styles', models.ManyToManyField(to='style.DocumentStyle')),
                ('export_templates', models.ManyToManyField(blank=True, to='document.ExportTemplate')),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]

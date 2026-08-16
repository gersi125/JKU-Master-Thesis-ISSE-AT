using System;
public class Person
{
    private string Name { get; set; }
    private int Age { get; set; }

    private void MethDec(bool isActive) {
        Console.WriteLine("Method Declaration");
    }


    public Person(string name, int age)
    {
        Name = name;
        Age = age;

    }
     

}


